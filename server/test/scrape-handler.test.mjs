import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { createPool } from "../db/pool.mjs";
import { migrate } from "../db/migrate.mjs";
import { createRepositories } from "../db/repositories/index.mjs";
import { createScrapeSourceHandler } from "../jobs/handlers/scrape-source.mjs";
import { PostgresJobQueue } from "../jobs/queue.mjs";
import { encryptSourceUrl } from "../security/source-url.mjs";
import { testDatabaseUrl } from "./database-url.mjs";

const databaseUrl = testDatabaseUrl();
const sourceKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

class MemoryArtifacts {
  constructor() { this.values = new Map(); }
  async putOnce({ key, bytes, artifactHash, contentType }) {
    const existing = this.values.get(key);
    if (existing && !existing.bytes.equals(bytes)) throw new Error("immutable_artifact_conflict");
    this.values.set(key, { bytes: Buffer.from(bytes), artifactHash, contentType });
  }
  async getStream(key) {
    const value = this.values.get(key);
    if (!value) throw new Error("artifact_not_found");
    return Readable.from(value.bytes);
  }
}

test("scrape handler creates sealed immutable versions and records no-change", { skip: !databaseUrl }, async () => {
  const pool = createPool(databaseUrl);
  const suffix = randomUUID();
  const artifacts = new MemoryArtifacts();
  try {
    await migrate(pool);
    const repositories = createRepositories(pool);
    const source = await repositories.sources.create({
      canonical_url_ciphertext: encryptSourceUrl("https://example.test/series", sourceKey),
      canonical_url_hash: createHash("sha256").update(suffix).digest(),
      domain: "example.test",
      title: "Scrape fixture",
      source_type: "json_api",
      status: "active",
      next_scrape_at: new Date(),
    });
    const queue = new PostgresJobQueue(pool);
    const handler = createScrapeSourceHandler({ pool, artifactStore: artifacts, sourceUrlKey: sourceKey, requestBytes: async () => ({ url: "https://example.test/series", contentType: "application/json", headers: { etag: "fixture" }, bytes: Buffer.from(JSON.stringify([{ timestamp: "2025-01-01", value: 1 }, { timestamp: "2025-01-02", value: 2 }])) }) });

    const run = async (scheduledFor) => {
      await queue.enqueue({ type: "scrape.source", payload: { sourceId: source.id, reason: "manual", scheduledFor }, idempotencyKey: `scrape-handler-${suffix}-${scheduledFor}` });
      const job = await queue.claim({ workerId: "scrape-test", types: ["scrape.source"] });
      const result = await handler(job);
      await queue.complete(job.id, "scrape-test", result);
      return result;
    };

    const first = await run("2026-09-05T10:00:00.000Z");
    const second = await run("2026-09-05T11:00:00.000Z");
    assert.equal(first.changeType, "initial");
    assert.equal(second.changeType, "no_change");
    const versions = await pool.query("SELECT version, status FROM dataset_versions WHERE dataset_id = (SELECT id FROM datasets WHERE source_id = $1) ORDER BY version", [source.id]);
    assert.deepEqual(versions.rows.map((row) => ({ version: row.version, status: row.status })), [{ version: 1, status: "sealed" }, { version: 2, status: "sealed" }]);
    const runs = await pool.query("SELECT change_type, status FROM ingestion_runs WHERE source_id = $1 ORDER BY created_at", [source.id]);
    assert.deepEqual(runs.rows.map((row) => ({ changeType: row.change_type, status: row.status })), [{ changeType: "initial", status: "completed" }, { changeType: "no_change", status: "completed" }]);
  } finally {
    await pool.end();
  }
});

test("a retried scrape job records a second ingestion run instead of colliding with the first", { skip: !databaseUrl }, async () => {
  const pool = createPool(databaseUrl);
  const suffix = randomUUID();
  const artifacts = new MemoryArtifacts();
  try {
    await migrate(pool);
    const repositories = createRepositories(pool);
    const source = await repositories.sources.create({
      canonical_url_ciphertext: encryptSourceUrl("https://example.test/retry", sourceKey),
      canonical_url_hash: createHash("sha256").update(`retry-${suffix}`).digest(),
      domain: "example.test",
      title: "Scrape retry fixture",
      source_type: "json_api",
      status: "active",
      next_scrape_at: new Date(),
    });
    const queue = new PostgresJobQueue(pool);

    // The first attempt fails the way a real source does; the retry succeeds.
    let attempts = 0;
    const handler = createScrapeSourceHandler({
      pool,
      artifactStore: artifacts,
      sourceUrlKey: sourceKey,
      requestBytes: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("redirect_blocked");
        return { url: "https://example.test/retry", contentType: "application/json", headers: { etag: "retry" }, bytes: Buffer.from(JSON.stringify([{ timestamp: "2025-02-01", value: 3 }, { timestamp: "2025-02-02", value: 4 }])) };
      },
    });

    const enqueued = await queue.enqueue({ type: "scrape.source", payload: { sourceId: source.id, reason: "scheduled", scheduledFor: "2026-09-06T00:00:00.000Z" }, idempotencyKey: `scrape-retry-${suffix}` });
    const failing = await queue.claim({ workerId: "scrape-retry-test", types: ["scrape.source"] });
    assert.equal(failing.id, enqueued.job.id);
    await assert.rejects(() => handler(failing), /redirect_blocked/);
    const waiting = await queue.fail(failing.id, "scrape-retry-test", { errorCode: "job_failed", retryDelaySeconds: 0 });
    assert.equal(waiting.status, "retry_wait");

    const retried = await queue.claim({ workerId: "scrape-retry-test", types: ["scrape.source"] });
    assert.equal(retried.id, enqueued.job.id);
    assert.equal(retried.attempts, 2);
    const result = await handler(retried);
    await queue.complete(retried.id, "scrape-retry-test", result);
    assert.equal(result.changeType, "initial");

    const runs = await pool.query("SELECT attempt, status, error_detail FROM ingestion_runs WHERE job_id = $1 ORDER BY attempt", [enqueued.job.id]);
    assert.deepEqual(runs.rows.map((row) => ({ attempt: row.attempt, status: row.status })), [{ attempt: 1, status: "failed" }, { attempt: 2, status: "completed" }]);
    // The original cause has to survive; a constraint error must not replace it.
    assert.match(runs.rows[0].error_detail, /redirect_blocked/);
  } finally {
    await pool.end();
  }
});

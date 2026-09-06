import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createPool } from "../db/pool.mjs";
import { migrate } from "../db/migrate.mjs";
import { PostgresJobQueue } from "../jobs/queue.mjs";
import { testDatabaseUrl } from "./database-url.mjs";

const databaseUrl = testDatabaseUrl();

test("Postgres queue is idempotent, lease-safe, retryable, and dead-lettered", { skip: !databaseUrl }, async () => {
  const pool = createPool(databaseUrl);
  const suffix = crypto.randomUUID();
  const queue = new PostgresJobQueue(pool, { leaseSeconds: 30 });
  try {
    await migrate(pool, { migrationsDir: new URL("../db/migrations/", import.meta.url) });

    const scrapePayload = { sourceId: suffix, reason: "manual", scheduledFor: "2026-09-05T10:00:00.000Z" };
    const first = await queue.enqueue({ type: "scrape.source", payload: scrapePayload, idempotencyKey: `queue-first-${suffix}` });
    const duplicate = await queue.enqueue({ type: "scrape.source", payload: scrapePayload, idempotencyKey: `queue-first-${suffix}` });
    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(first.job.id, duplicate.job.id);

    const claimed = await queue.claim({ workerId: "scrape-worker", types: ["scrape.source"] });
    assert.equal(claimed.id, first.job.id);
    assert.equal(claimed.attempts, 1);
    await assert.rejects(() => queue.complete(claimed.id, "other-worker"), /job_lease_not_owned/);
    const renewed = await queue.heartbeat(claimed.id, "scrape-worker");
    assert.equal(renewed.status, "running");
    const completed = await queue.complete(claimed.id, "scrape-worker", { records: 2 });
    assert.equal(completed.status, "completed");

    const retry = await queue.enqueue({ type: "analysis.run", payload: { analysisRunId: suffix }, idempotencyKey: `queue-retry-${suffix}`, maxAttempts: 2 });
    const retryClaimed = await queue.claim({ workerId: "analysis-worker", types: ["analysis.run"] });
    assert.equal(retryClaimed.id, retry.job.id);
    const waiting = await queue.fail(retryClaimed.id, "analysis-worker", { errorCode: "transient", retryDelaySeconds: 0 });
    assert.equal(waiting.status, "retry_wait");
    const secondAttempt = await queue.claim({ workerId: "analysis-worker", types: ["analysis.run"] });
    assert.equal(secondAttempt.attempts, 2);
    const dead = await queue.fail(secondAttempt.id, "analysis-worker", { errorCode: "exhausted", retryDelaySeconds: 0 });
    assert.equal(dead.status, "dead_letter");
  } finally {
    await pool.end();
  }
});

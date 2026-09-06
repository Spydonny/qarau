import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import test from "node:test";
import { createPool } from "../db/pool.mjs";
import { migrate } from "../db/migrate.mjs";
import { createRepositories } from "../db/repositories/index.mjs";
import { testDatabaseUrl } from "./database-url.mjs";

const databaseUrl = testDatabaseUrl();
const enabled = Boolean(databaseUrl);
const hash = (byte) => Buffer.alloc(32, byte);

test("PostgreSQL migration is idempotent and repository invariants hold", { skip: !enabled }, async () => {
  const pool = createPool(databaseUrl);
  try {
    const first = await migrate(pool);
    const second = await migrate(pool);
    // Test files share one database and migrate in parallel, so `applied` may
    // legitimately be empty here. What must hold is that the runner sees every
    // migration on disk and that a second pass is a no-op. Counting the files
    // keeps this from breaking every time a migration is added.
    const migrationFiles = (await readdir(new URL("../db/migrations/", import.meta.url))).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name));
    assert.equal(first.total, migrationFiles.length);
    assert.deepEqual(second.applied, []);

    const repositories = createRepositories(pool);
    const source = await repositories.sources.create({
      canonical_url_ciphertext: Buffer.from("encrypted-url"),
      canonical_url_hash: hash(1),
      domain: "example.test",
      title: "Repository contract fixture",
      source_type: "json_api",
      status: "active",
      reliability: {},
      license_status: "approved",
      redistribution_rights: true,
      derivative_rights: true,
    });
    assert.equal((await repositories.sources.findByCanonicalHash(hash(1))).id, source.id);

    const dataset = await repositories.datasets.create({ source_id: source.id, name: "Fixture", semantic_schema: {} });
    const makeSnapshot = async (attempt, byte) => {
      const run = await repositories.ingestionRuns.create({ source_id: source.id, status: "completed", attempt, change_type: attempt === 1 ? "initial" : "no_change" });
      return repositories.sourceSnapshots.create({
        source_id: source.id,
        ingestion_run_id: run.id,
        raw_object_key: `raw/test/${run.id}/response-body.bin`,
        raw_hash: hash(byte),
        retrieval_timestamp: new Date(),
      });
    };

    const [snapshot1, snapshot2] = await Promise.all([makeSnapshot(1, 2), makeSnapshot(2, 3)]);
    const versions = await Promise.all([
      repositories.datasetVersions.allocate(dataset.id, snapshot1.id),
      repositories.datasetVersions.allocate(dataset.id, snapshot2.id),
    ]);
    assert.deepEqual(versions.map(({ version }) => version).sort(), [1, 2]);

    const version = versions[0];
    await repositories.datasetVersions.transition(version.id, "allocated", "normalizing");
    await repositories.datasetVersions.transition(version.id, "normalizing", "uploading");
    await repositories.datasetVersions.transition(version.id, "uploading", "stored", {
      normalized_object_key: `normalized/${dataset.id}/v${version.version}/data.jsonl`,
      normalized_hash: hash(4),
      record_count: 10,
      schema_profile: {},
      quality_metrics: {},
    });
    const sealed = await repositories.datasetVersions.transition(version.id, "stored", "sealed", { sealed_at: new Date() });
    assert.equal(sealed.status, "sealed");
    await assert.rejects(() => repositories.datasetVersions.transition(version.id, "sealed", "failed"), /terminal_dataset_version/);
    await assert.rejects(() => pool.query("UPDATE source_snapshots SET raw_hash = $2 WHERE id = $1", [snapshot1.id, hash(9)]), /immutable_record/);

    const audit = await repositories.audits.create({ actor_type: "system", action: "contract_test", resource_type: "dataset", resource_id: dataset.id, outcome: "passed", metadata: {} });
    await assert.rejects(() => pool.query("DELETE FROM audit_events WHERE id = $1", [audit.id]), /immutable_record/);
  } finally {
    await pool.end();
  }
});

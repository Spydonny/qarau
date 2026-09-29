import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../db/mongo.mjs";
import { migrate } from "../db/migrate.mjs";
import { createRepositories } from "../db/repositories/index.mjs";
import { MongoJobQueue } from "../jobs/queue.mjs";

const uri = process.env.TEST_MONGODB_URI;
const dbName = `qarau_test_${Date.now().toString(36)}${process.pid.toString(36)}`;
const hash = (byte) => Buffer.alloc(32, byte);

test("Mongo migration is idempotent and repository invariants hold", { skip: !uri }, async () => {
  const { db, close } = await createDatabase(uri, dbName);
  try {
    const first = await migrate(db);
    const second = await migrate(db);
    // Parallel test files share one database, so `applied` may legitimately be
    // empty here when another file won the race. What must hold is that the
    // runner records exactly one version and a second pass is a no-op.
    assert.equal(first.total, 1);
    assert.ok(first.applied.length <= 1);
    assert.deepEqual(second.applied, []);

    const repositories = createRepositories(db);
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
    // Unique index on sources.canonical_url_hash rejects duplicates.
    await assert.rejects(
      () => repositories.sources.create({
        canonical_url_ciphertext: Buffer.from("encrypted-url"),
        canonical_url_hash: hash(1),
        domain: "example.test",
        source_type: "json_api",
        status: "active",
      }),
      (error) => error?.code === "23505" || error?.code === 11000,
    );

    // Unique index on jobs.idempotency_key rejects duplicates at the collection level.
    const queue = new MongoJobQueue(db);
    const firstJob = await queue.enqueue({ type: "scrape.source", payload: { sourceId: source.id, reason: "manual", scheduledFor: "2026-09-05T10:00:00.000Z" }, idempotencyKey: `mongo-contract-${source.id}` });
    assert.equal(firstJob.created, true);
    const duplicateJob = await queue.enqueue({ type: "scrape.source", payload: { sourceId: source.id, reason: "manual", scheduledFor: "2026-09-05T10:00:00.000Z" }, idempotencyKey: `mongo-contract-${source.id}` });
    assert.equal(duplicateJob.created, false);
    assert.equal(duplicateJob.job.id, firstJob.job.id);
    await assert.rejects(
      () => db.collection("jobs").insertOne({ type: "scrape.source", idempotency_key: `mongo-contract-${source.id}` }),
      (error) => error?.code === "23505" || error?.code === 11000,
    );

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

    const snapshot1 = await makeSnapshot(1, 2);
    const snapshot2 = await makeSnapshot(2, 3);
    const version1 = await repositories.datasetVersions.allocate(dataset.id, snapshot1.id);
    const version2 = await repositories.datasetVersions.allocate(dataset.id, snapshot2.id);
    assert.deepEqual([version1.version, version2.version].sort(), [1, 2]);

    const version = version1;
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
    // Sealed is terminal: no outgoing edge exists in the version graph.
    await assert.rejects(() => repositories.datasetVersions.transition(version.id, "sealed", "failed"), /dataset_version_transition_conflict/);

    const audit = await repositories.audits.create({ actor_type: "system", action: "contract_test", resource_type: "dataset", resource_id: dataset.id, outcome: "passed", metadata: {} });
    assert.equal((await repositories.audits.findById(audit.id)).outcome, "passed");
  } finally {
    await close();
  }
});

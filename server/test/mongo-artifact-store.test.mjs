import assert from "node:assert/strict";
import test from "node:test";
import { MongoArtifactStore } from "../storage/mongo-artifact-store.mjs";

function memoryDatabase() {
  const collections = new Map();
  return {
    async command() { return { ok: 1 }; },
    collection(name) {
      if (!collections.has(name)) {
        const docs = new Map();
        collections.set(name, {
          docs,
          async findOne({ _id }) { return docs.get(_id) ?? null; },
          async insertOne(doc) {
            if (docs.has(doc._id)) throw Object.assign(new Error("duplicate key"), { code: 11000 });
            docs.set(doc._id, structuredClone(doc));
          },
        });
      }
      return collections.get(name);
    },
  };
}

test("Mongo artifacts stay immutable across chunks and reads verify content", async () => {
  const db = memoryDatabase();
  const store = new MongoArtifactStore({ db });
  const key = "raw/source/snapshot.bin";
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 3, 7);
  const artifactHash = "a".repeat(64);
  assert.equal((await store.putOnce({ key, bytes, artifactHash })).created, true);
  assert.equal((await store.putOnce({ key, bytes, artifactHash })).created, false);
  assert.deepEqual(await store.getVerifiedBytes({ key, expectedArtifactHash: artifactHash }), bytes);
  await assert.rejects(() => store.putOnce({ key, bytes: Buffer.from("different"), artifactHash }), /immutable_artifact_conflict/);
  await assert.rejects(() => store.getVerifiedBytes({ key, expectedArtifactHash: "b".repeat(64) }), /artifact_commitment_mismatch/);
  db.collection("private_artifact_chunks").docs.get(`${key}:1`).bytes[0] ^= 1;
  await assert.rejects(() => store.getVerifiedBytes({ key }), /artifact_content_hash_mismatch/);
});

test("Mongo artifacts require an explicit authorization decision", async () => {
  const store = new MongoArtifactStore({ db: memoryDatabase() });
  const key = "packages/example/report.json";
  await store.putOnce({ key, bytes: Buffer.from("private"), artifactHash: "c".repeat(64) });
  await assert.rejects(() => store.authorizedStream({ key, authorize: async () => false }), /artifact_access_denied/);
  const stream = await store.authorizedStream({ key, authorize: async () => true });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), "private");
});

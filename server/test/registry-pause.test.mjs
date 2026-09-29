import assert from "node:assert/strict";
import test from "node:test";
import { createChainPauseHandler } from "../jobs/handlers/chain-pause.mjs";
import { jobTypesForRole, parseJobPayload } from "../jobs/payloads.mjs";
import { setRegistryPausedOnChain } from "../signer/publisher.mjs";

const OWNER = "00000000-0000-4000-8000-000000000001";
// Fake db in the shape handlers consume: collection(name) returns a minimal
// audit_events collection capturing insertOne documents.
function fakeDb() {
  const inserted = [];
  return {
    inserted,
    db: {
      collection: () => ({
        findOne: async () => null,
        findOneAndUpdate: async () => null,
        insertOne: async (doc) => {
          inserted.push({ ...doc });
          return { acknowledged: true, insertedId: doc._id };
        },
      }),
    },
  };
}
function signerResponse(ok, payload) {
  return { ok, json: async () => payload };
}

test("chain.pause payload is strict, versioned, and owned by worker-chain", () => {
  const payload = { paused: true, requestedBy: OWNER };
  assert.deepEqual(parseJobPayload("chain.pause", 1, payload), payload);
  assert.throws(() => parseJobPayload("chain.pause", 1, { ...payload, programId: "spoofed" }));
  assert.throws(() => parseJobPayload("chain.pause", 1, { paused: "true", requestedBy: OWNER }));
  assert.ok(jobTypesForRole("worker-chain").includes("chain.pause"));
  assert.equal(jobTypesForRole("api").includes("chain.pause"), false);
});

test("pause handler calls the isolated signer and records an immutable audit row", async () => {
  const fake = fakeDb();
  const calls = [];
  const handler = createChainPauseHandler({
    db: fake.db,
    publisherSignerUrl: "http://signer:8796/",
    publisherSignerToken: "publisher-token-long-enough",
    fetchImpl: async (url, options) => { calls.push({ url, options }); return signerResponse(true, { registryPda: "Reg111", paused: true, transaction: { signature: "sig-1" }, finalizedSlot: 42 }); },
  });

  const result = await handler({ id: "job-1", payload: { paused: true, requestedBy: OWNER } });

  assert.equal(calls[0].url, "http://signer:8796/pause");
  assert.equal(calls[0].options.headers["x-publisher-token"], "publisher-token-long-enough");
  assert.deepEqual(JSON.parse(calls[0].options.body), { paused: true });
  assert.deepEqual(result, { paused: true, registryPda: "Reg111", signature: "sig-1", finalizedSlot: 42 });

  assert.equal(fake.inserted.length, 1);
  const audit = fake.inserted[0];
  assert.equal(audit.actor_type, "owner");
  assert.deepEqual([audit.actor_id, audit.action, audit.resource_id, audit.request_id, audit.outcome], [OWNER, "registry.pause", "Reg111", "job-1", "applied"]);
  assert.deepEqual(audit.metadata, { paused: true, signature: "sig-1", slot: 42, error: null });
});

test("a refused kill-switch is still audited and surfaces the signer error", async () => {
  const fake = fakeDb();
  const handler = createChainPauseHandler({
    db: fake.db,
    publisherSignerUrl: "http://signer:8796",
    publisherSignerToken: "publisher-token-long-enough",
    fetchImpl: async () => signerResponse(false, { error: "registry_not_found" }),
  });

  await assert.rejects(() => handler({ id: "job-2", payload: { paused: false, requestedBy: OWNER } }), /registry_not_found/);
  assert.equal(fake.inserted.length, 1);
  assert.equal(fake.inserted[0].action, "registry.unpause");
  assert.equal(fake.inserted[0].outcome, "failed");
  assert.equal(fake.inserted[0].metadata.error, "registry_not_found");
});

test("the kill-switch refuses non-boolean flags and non-devnet networks", async () => {
  const signer = { address: "Signer111" };
  await assert.rejects(() => setRegistryPausedOnChain({ signer, rpcUrl: "https://api.mainnet-beta.solana.com", programId: "Prog111", paused: true }), /unsupported_solana_network/);
  await assert.rejects(() => setRegistryPausedOnChain({ signer, rpcUrl: "https://api.devnet.solana.com", programId: "Prog111", paused: "true" }), /invalid_paused_flag/);
  await assert.rejects(() => setRegistryPausedOnChain({ signer: null, rpcUrl: "https://api.devnet.solana.com", programId: "Prog111", paused: true }), /publisher_signing_disabled/);
});

test("pause dependencies are mandatory so a misconfigured worker cannot no-op", () => {
  assert.throws(() => createChainPauseHandler({ db: fakeDb().db, publisherSignerUrl: "http://signer:8796" }), /chain_pause_dependencies_required/);
  assert.throws(() => createChainPauseHandler({ publisherSignerUrl: "http://signer:8796", publisherSignerToken: "token-long-enough" }), /chain_pause_dependencies_required/);
});

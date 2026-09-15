import assert from "node:assert/strict";
import test from "node:test";
import { createChainPauseHandler } from "../jobs/handlers/chain-pause.mjs";
import { jobTypesForRole, parseJobPayload } from "../jobs/payloads.mjs";
import { setRegistryPausedOnChain } from "../signer/publisher.mjs";

const OWNER = "00000000-0000-4000-8000-000000000001";
function fakePool() {
  const queries = [];
  return { queries, query: async (text, values) => { queries.push({ text, values }); return { rows: [], rowCount: 0 }; } };
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
  const pool = fakePool();
  const calls = [];
  const handler = createChainPauseHandler({
    pool,
    publisherSignerUrl: "http://signer:8796/",
    publisherSignerToken: "publisher-token-long-enough",
    fetchImpl: async (url, options) => { calls.push({ url, options }); return signerResponse(true, { registryPda: "Reg111", paused: true, transaction: { signature: "sig-1" }, finalizedSlot: 42 }); },
  });

  const result = await handler({ id: "job-1", payload: { paused: true, requestedBy: OWNER } });

  assert.equal(calls[0].url, "http://signer:8796/pause");
  assert.equal(calls[0].options.headers["x-publisher-token"], "publisher-token-long-enough");
  assert.deepEqual(JSON.parse(calls[0].options.body), { paused: true });
  assert.deepEqual(result, { paused: true, registryPda: "Reg111", signature: "sig-1", finalizedSlot: 42 });

  assert.equal(pool.queries.length, 1);
  assert.match(pool.queries[0].text, /INSERT INTO audit_events/);
  assert.deepEqual(pool.queries[0].values.slice(0, 5), [OWNER, "registry.pause", "Reg111", "job-1", "applied"]);
  assert.deepEqual(pool.queries[0].values[5], { paused: true, signature: "sig-1", slot: 42, error: null });
});

test("a refused kill-switch is still audited and surfaces the signer error", async () => {
  const pool = fakePool();
  const handler = createChainPauseHandler({
    pool,
    publisherSignerUrl: "http://signer:8796",
    publisherSignerToken: "publisher-token-long-enough",
    fetchImpl: async () => signerResponse(false, { error: "registry_not_found" }),
  });

  await assert.rejects(() => handler({ id: "job-2", payload: { paused: false, requestedBy: OWNER } }), /registry_not_found/);
  assert.equal(pool.queries.length, 1);
  assert.equal(pool.queries[0].values[1], "registry.unpause");
  assert.equal(pool.queries[0].values[4], "failed");
  assert.equal(pool.queries[0].values[5].error, "registry_not_found");
});

test("the kill-switch refuses non-boolean flags and non-devnet networks", async () => {
  const signer = { address: "Signer111" };
  await assert.rejects(() => setRegistryPausedOnChain({ signer, rpcUrl: "https://api.mainnet-beta.solana.com", programId: "Prog111", paused: true }), /unsupported_solana_network/);
  await assert.rejects(() => setRegistryPausedOnChain({ signer, rpcUrl: "https://api.devnet.solana.com", programId: "Prog111", paused: "true" }), /invalid_paused_flag/);
  await assert.rejects(() => setRegistryPausedOnChain({ signer: null, rpcUrl: "https://api.devnet.solana.com", programId: "Prog111", paused: true }), /publisher_signing_disabled/);
});

test("pause dependencies are mandatory so a misconfigured worker cannot no-op", () => {
  assert.throws(() => createChainPauseHandler({ pool: fakePool(), publisherSignerUrl: "http://signer:8796" }), /chain_pause_dependencies_required/);
  assert.throws(() => createChainPauseHandler({ publisherSignerUrl: "http://signer:8796", publisherSignerToken: "token-long-enough" }), /chain_pause_dependencies_required/);
});

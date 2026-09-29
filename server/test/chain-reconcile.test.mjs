import assert from "node:assert/strict";
import test from "node:test";
import { RECONCILE_UPDATE, createChainReconcileHandler } from "../jobs/handlers/chain-reconcile.mjs";
import { enqueueStaleRounds } from "../scheduler/enqueue-stale-rounds.mjs";
import { jobIdempotencyKey, parseJobPayload } from "../jobs/payloads.mjs";

const ROUND_PDA = "Round1111111111111111111111111111111111111";
const NOW = Date.parse("2026-09-15T12:30:40.000Z");

function storedRound(overrides = {}) {
  return {
    _id: "123e4567-e89b-42d3-a456-426614174000",
    round_pda: ROUND_PDA,
    network: "devnet",
    program_id: "Prog111",
    state: "live",
    opens_at: "2026-09-15T10:00:00.000Z",
    closes_at: "2026-09-15T11:00:00.000Z",
    decoded_state: { treasury: "Treasury111" },
    slot: 0,
    ...overrides,
  };
}
// Fake db in the shape handlers consume: { collection(name) -> { findOne,
// findOneAndUpdate, find(...).sort(...).limit(...).project(...).toArray() } }.
function fakeDb({ round = null, staleRows = [] } = {}) {
  const calls = [];
  const accessRounds = {
    findOne: async () => (round ? { ...round } : null),
    findOneAndUpdate: async (filter, update) => {
      calls.push({ filter, update });
      return { ...round, ...filter };
    },
  };
  const chain = () => ({
    sort: () => ({
      limit: () => ({
        project: () => ({ toArray: async () => staleRows.map((row) => ({ ...row })) }),
      }),
    }),
  });
  return {
    calls,
    db: {
      collection: (name) => {
        calls.push({ collection: name });
        if (name === "access_rounds") {
          return {
            ...accessRounds,
            find: (filter) => {
              calls.push({ find: filter });
              return chain();
            },
          };
        }
        return { findOne: async () => null, findOneAndUpdate: async () => null, insertOne: async (doc) => ({ acknowledged: true, insertedId: doc._id }) };
      },
    },
  };
}
function chainRound(overrides = {}) {
  return { roundPda: ROUND_PDA, status: 1, bidCount: 7, winnersCount: 0, claimedCount: 0, clearingPriceLamports: 0, treasury: "Treasury111", slot: 900, ...overrides };
}

test("reconcile refreshes permissionless bid counts and advances a closed round", async () => {
  const fake = fakeDb({ round: storedRound() });
  const handler = createChainReconcileHandler({ db: fake.db, rpcUrl: "https://api.devnet.solana.com", readAccessRoundImpl: async () => chainRound(), now: () => NOW });

  const result = await handler({ id: "job-1", payload: { network: "devnet", account: ROUND_PDA, observedFor: "2026-09-15T12:30:00.000Z" } });

  assert.equal(result.state, "ended");
  assert.equal(result.stateChanged, true);
  assert.equal(result.bidCount, 7);
  const update = fake.calls.find((call) => call.update);
  assert.equal(update.filter._id, "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(update.update.$set.state, "ended");
  assert.equal(update.update.$set.bid_count, 7);
  assert.deepEqual(update.update.$set.decoded_state, { treasury: "Treasury111", bid_count: 7, winners_count: 0, claimed_count: 0, clearing_price_lamports: 0 });
  assert.ok(update.update.$set.last_reconciled_at instanceof Date);
});

test("the reconcile descriptor names the access_rounds update contract", () => {
  assert.ok(Object.isFrozen(RECONCILE_UPDATE));
  assert.equal(RECONCILE_UPDATE.collection, "access_rounds");
  assert.ok(RECONCILE_UPDATE.set.includes("state"));
  assert.ok(RECONCILE_UPDATE.set.includes("decoded_state"));
});

test("a settled round on chain is promoted, and a claimed round is never rewound", async () => {
  const settling = fakeDb({ round: storedRound() });
  const promote = createChainReconcileHandler({ db: settling.db, rpcUrl: "https://api.devnet.solana.com", readAccessRoundImpl: async () => chainRound({ status: 2, winnersCount: 3, clearingPriceLamports: 500 }), now: () => NOW });
  const promoted = await promote({ id: "job-2", payload: { network: "devnet", account: ROUND_PDA, observedFor: "2026-09-15T12:30:00.000Z" } });
  assert.equal(promoted.state, "settled");
  assert.equal(settling.calls.find((call) => call.update).update.$set.clearing_price_lamports, 500);

  const claimed = fakeDb({ round: storedRound({ state: "access_granted" }) });
  const keep = createChainReconcileHandler({ db: claimed.db, rpcUrl: "https://api.devnet.solana.com", readAccessRoundImpl: async () => chainRound({ status: 2, winnersCount: 3 }), now: () => NOW });
  const result = await keep({ id: "job-3", payload: { network: "devnet", account: ROUND_PDA, observedFor: "2026-09-15T12:30:00.000Z" } });
  assert.equal(result.state, "access_granted");
  assert.equal(result.stateChanged, false);
});

test("reconcile fails loudly when the round is unknown locally or absent on chain", async () => {
  const missingLocal = createChainReconcileHandler({ db: fakeDb().db, rpcUrl: "https://api.devnet.solana.com", readAccessRoundImpl: async () => chainRound(), now: () => NOW });
  await assert.rejects(() => missingLocal({ id: "j", payload: { network: "devnet", account: ROUND_PDA, observedFor: "2026-09-15T12:30:00.000Z" } }), /access_round_not_found/);

  const missingChain = createChainReconcileHandler({ db: fakeDb({ round: storedRound() }).db, rpcUrl: "https://api.devnet.solana.com", readAccessRoundImpl: async () => null, now: () => NOW });
  await assert.rejects(() => missingChain({ id: "j", payload: { network: "devnet", account: ROUND_PDA, observedFor: "2026-09-15T12:30:00.000Z" } }), /access_round_not_found/);

  assert.throws(() => createChainReconcileHandler({ db: fakeDb().db }), /chain_reconcile_dependencies_required/);
});

test("the reconcile payload is versioned and carries its observation window", () => {
  const payload = { network: "devnet", account: ROUND_PDA, observedFor: "2026-09-15T12:30:00.000Z" };
  assert.deepEqual(parseJobPayload("chain.reconcile", 2, payload), payload);
  assert.throws(() => parseJobPayload("chain.reconcile", 1, payload), /unsupported_job_payload_version/);
  assert.throws(() => parseJobPayload("chain.reconcile", 2, { network: "devnet", account: ROUND_PDA }));
});

test("scheduler reconciles each stale round once per minute window", async () => {
  const rows = [
    { _id: "round-a", round_pda: "PdaA", network: "devnet" },
    { _id: "round-b", round_pda: "PdaB", network: "devnet" },
  ];
  const calls = [];
  const fake = fakeDb({ staleRows: rows });
  const queue = { enqueue: async (input) => { calls.push(input); return { created: true, job: { id: input.resourceId } }; } };

  const result = await enqueueStaleRounds({ db: fake.db, queue, now: new Date("2026-09-15T12:30:40.000Z") });

  assert.equal(result.observedFor, "2026-09-15T12:30:00.000Z");
  assert.equal(result.enqueued, 2);
  assert.equal(calls[0].payloadVersion, 2);
  assert.equal(calls[0].payload.observedFor, "2026-09-15T12:30:00.000Z");
  assert.notEqual(calls[0].idempotencyKey, calls[1].idempotencyKey);
  assert.equal(calls[0].idempotencyKey, jobIdempotencyKey("chain.reconcile", 2, { network: "devnet", account: "PdaA", observedFor: "2026-09-15T12:30:00.000Z" }));
  assert.notEqual(
    calls[0].idempotencyKey,
    jobIdempotencyKey("chain.reconcile", 2, { network: "devnet", account: "PdaA", observedFor: "2026-09-15T12:31:00.000Z" }),
  );
});

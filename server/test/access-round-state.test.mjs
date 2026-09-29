import assert from "node:assert/strict";
import test from "node:test";
import { effectiveAccessRoundState } from "../domain/access-round-state.mjs";
import { createChainSettleHandler } from "../jobs/handlers/chain-settle.mjs";

const opensAt = "2026-09-06T10:00:00.000Z";
const closesAt = "2026-09-06T11:00:00.000Z";

test("effective access-round state follows its time window instead of a stale stored state", () => {
  const round = { state: "upcoming", opens_at: opensAt, closes_at: closesAt };
  assert.equal(effectiveAccessRoundState(round, "2026-09-06T09:59:59.000Z"), "upcoming");
  assert.equal(effectiveAccessRoundState(round, "2026-09-06T10:30:00.000Z"), "live");
  assert.equal(effectiveAccessRoundState(round, "2026-09-06T11:00:01.000Z"), "ended");
});

test("effective access-round state never rewinds terminal states", () => {
  for (const state of ["settled", "access_granted", "expired"]) {
    assert.equal(effectiveAccessRoundState({ round_state: state, opens_at: opensAt, closes_at: closesAt }, "2026-09-06T10:30:00.000Z"), state);
  }
});

test("settlement reconciles a stale upcoming round to ended and proceeds", async () => {
  const store = new Map();
  const roundDoc = { _id: "round-id", state: "upcoming", round_pda: "round-pda", network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified", opens_at: opensAt, closes_at: closesAt };
  store.set("round-id", roundDoc);
  const updates = [];
  const match = (doc, filter) => Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === "object" && "$in" in cond) return cond.$in.includes(doc[key]);
    return doc[key] === cond;
  });
  const db = {
    collection: () => ({
      findOne: async (filter) => [roundDoc].find((doc) => match(doc, filter)) ?? null,
      findOneAndUpdate: async (filter, update) => {
        const doc = [roundDoc].find((d) => match(d, filter)) ?? null;
        if (!doc) return null;
        Object.assign(doc, update.$set ?? {});
        updates.push(update.$set ?? {});
        return { ...doc };
      },
    }),
  };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ transaction: { signature: "settlement-signature" } }) });
  const readAccessRoundImpl = async () => ({ status: 2, bidCount: 3, winnersCount: 2, clearingPriceLamports: 50, slot: 42, treasury: "treasury", claimedCount: 0 });
  const settle = createChainSettleHandler({ db, publisherSignerUrl: "http://signer", publisherSignerToken: "token", rpcUrl: "http://rpc", programId: "program", fetchImpl, readAccessRoundImpl, now: () => Date.parse("2026-09-06T11:00:01.000Z") });

  const result = await settle({ payload: { accessRoundId: roundDoc._id } });

  assert.equal(result.accessRoundId, roundDoc._id);
  assert.equal(result.winnersCount, 2);
  assert.ok(updates.some((patch) => patch.state === "ended"));
  assert.ok(updates.some((patch) => patch.state === "settled"));
});

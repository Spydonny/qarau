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
  const queries = [];
  const round = { id: "round-id", state: "upcoming", round_pda: "round-pda", opens_at: opensAt, closes_at: closesAt };
  const pool = {
    query: async (sql, params) => {
      queries.push([sql, params]);
      if (sql.startsWith("SELECT")) return { rows: [round] };
      return { rows: [], rowCount: 1 };
    },
  };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ transaction: { signature: "settlement-signature" } }) });
  const readAccessRoundImpl = async () => ({ status: 2, bidCount: 3, winnersCount: 2, clearingPriceLamports: 50, slot: 42, treasury: "treasury", claimedCount: 0 });
  const settle = createChainSettleHandler({ pool, publisherSignerUrl: "http://signer", publisherSignerToken: "token", rpcUrl: "http://rpc", programId: "program", fetchImpl, readAccessRoundImpl, now: () => Date.parse("2026-09-06T11:00:01.000Z") });

  const result = await settle({ payload: { accessRoundId: round.id } });

  assert.equal(result.accessRoundId, round.id);
  assert.equal(result.winnersCount, 2);
  assert.ok(queries.some(([sql, params]) => sql.includes("SET state = $2") && params[1] === "ended"));
  assert.ok(queries.some(([sql]) => sql.includes("SET state = 'settled'")));
});

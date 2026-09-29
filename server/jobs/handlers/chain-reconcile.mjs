import { createRepositories } from "../../db/repositories/index.mjs";
import { readAccessRound } from "../../solana/registry-client.mjs";
import { effectiveAccessRoundState } from "../../domain/access-round-state.mjs";

// Lifecycle rank. Reconciliation may only advance a round: a chain read that
// arrives after a claim must never rewind access_granted back to settled.
const STATE_RANK = Object.freeze({ upcoming: 0, live: 1, ended: 2, settled: 3, access_granted: 4, expired: 5 });

function advancedState(stored, observed) {
  const from = STATE_RANK[stored] ?? -1;
  const to = STATE_RANK[observed] ?? -1;
  return to > from ? observed : stored;
}

export const RECONCILE_UPDATE = Object.freeze({
  collection: "access_rounds",
  operation: "reconcile",
  matchBy: Object.freeze(["id"]),
  set: Object.freeze(["state", "bid_count", "winners_count", "clearing_price_lamports", "slot", "decoded_state", "last_reconciled_at"]),
  clearingPricePolicy: "null_if_zero",
  slotPolicy: "greatest_coalesce_zero",
});

/** Refreshes one access round from chain; bids are permissionless, so the row drifts. */
export function createChainReconcileHandler({ db, rpcUrl, readAccessRoundImpl = readAccessRound, now = () => Date.now() }) {
  if (!db || !rpcUrl) throw new Error("chain_reconcile_dependencies_required");
  const repositories = createRepositories(db);
  return async function reconcile(job) {
    const { network, account } = job.payload;
    const stored = await repositories.accessRounds.findByPda(account, network);
    if (!stored) throw new Error("access_round_not_found");
    const chain = await readAccessRoundImpl({ rpcUrl, programId: stored.program_id, roundPda: account });
    if (!chain) throw new Error("access_round_not_found");

    const observed = chain.status === 2 ? "settled" : effectiveAccessRoundState(stored, now());
    const state = advancedState(stored.state, observed);
    const decodedState = { treasury: stored.decoded_state?.treasury ?? chain.treasury ?? null, bid_count: chain.bidCount, winners_count: chain.winnersCount, claimed_count: chain.claimedCount, clearing_price_lamports: chain.clearingPriceLamports };
    await repositories.accessRounds.reconcileUpdate(stored.id, { state, bidCount: chain.bidCount, winnersCount: chain.winnersCount, clearingPrice: chain.clearingPriceLamports, slot: chain.slot ?? 0, decodedState });
    return { accessRoundId: stored.id, roundPda: account, state, stateChanged: state !== stored.state, bidCount: chain.bidCount, winnersCount: chain.winnersCount, slot: chain.slot ?? null };
  };
}

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

export const RECONCILE_UPDATE = "UPDATE access_rounds SET state = $2, bid_count = $3, winners_count = $4, clearing_price_lamports = NULLIF($5, 0), slot = GREATEST(COALESCE(slot, 0), $6), decoded_state = $7, last_reconciled_at = now() WHERE id = $1";

/** Refreshes one access round from chain; bids are permissionless, so the row drifts. */
export function createChainReconcileHandler({ pool, rpcUrl, readAccessRoundImpl = readAccessRound, now = () => Date.now() }) {
  if (!pool || !rpcUrl) throw new Error("chain_reconcile_dependencies_required");
  return async function reconcile(job) {
    const { network, account } = job.payload;
    const stored = (await pool.query("SELECT * FROM access_rounds WHERE round_pda = $1 AND network = $2", [account, network])).rows[0];
    if (!stored) throw new Error("access_round_not_found");
    const chain = await readAccessRoundImpl({ rpcUrl, programId: stored.program_id, roundPda: account });
    if (!chain) throw new Error("access_round_not_found");

    const observed = chain.status === 2 ? "settled" : effectiveAccessRoundState(stored, now());
    const state = advancedState(stored.state, observed);
    const decodedState = { treasury: stored.decoded_state?.treasury ?? chain.treasury ?? null, bid_count: chain.bidCount, winners_count: chain.winnersCount, claimed_count: chain.claimedCount, clearing_price_lamports: chain.clearingPriceLamports };
    await pool.query(RECONCILE_UPDATE, [stored.id, state, chain.bidCount, chain.winnersCount, chain.clearingPriceLamports, chain.slot ?? 0, decodedState]);
    return { accessRoundId: stored.id, roundPda: account, state, stateChanged: state !== stored.state, bidCount: chain.bidCount, winnersCount: chain.winnersCount, slot: chain.slot ?? null };
  };
}

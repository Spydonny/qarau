import { readAccessRound } from "../../solana/registry-client.mjs";

/** Settles only the exact persisted round through the isolated publisher signer. */
export function createChainSettleHandler({ pool, publisherSignerUrl, publisherSignerToken, rpcUrl, programId }) {
  if (!pool || !publisherSignerUrl || !publisherSignerToken || !rpcUrl || !programId) throw new Error("chain_settle_dependencies_required");
  return async function settle(job) {
    const result = await pool.query("SELECT * FROM access_rounds WHERE id = $1", [job.payload.accessRoundId]);
    const round = result.rows[0];
    if (!round || !["ended", "live"].includes(round.state)) throw new Error("access_round_not_settleable");
    if (new Date(round.closes_at).getTime() >= Date.now()) throw new Error("auction_still_open");
    const response = await fetch(`${publisherSignerUrl.replace(/\/$/, "")}/settle`, { method: "POST", headers: { "content-type": "application/json", "x-publisher-token": publisherSignerToken }, body: JSON.stringify({ roundPda: round.round_pda }), signal: AbortSignal.timeout(60_000) });
    const published = await response.json();
    if (!response.ok) throw new Error(published?.error ?? "publisher_signer_failed");
    const chain = await readAccessRound({ rpcUrl, programId, roundPda: round.round_pda });
    if (!chain || chain.status !== 2) throw new Error("auction_settlement_not_finalized");
    await pool.query("UPDATE access_rounds SET state = 'settled', bid_count = $2, winners_count = $3, clearing_price_lamports = NULLIF($4, 0), transaction_signature = COALESCE($5, transaction_signature), slot = $6, confirmation_status = 'finalized', decoded_state = $7, last_reconciled_at = now() WHERE id = $1", [round.id, chain.bidCount, chain.winnersCount, chain.clearingPriceLamports, published.transaction?.signature ?? null, chain.slot, { treasury: chain.treasury, bid_count: chain.bidCount, winners_count: chain.winnersCount, claimed_count: chain.claimedCount, clearing_price_lamports: chain.clearingPriceLamports }]);
    return { accessRoundId: round.id, roundPda: round.round_pda, winnersCount: chain.winnersCount, clearingPriceLamports: chain.clearingPriceLamports, finalizedSlot: chain.slot, signature: published.transaction?.signature ?? null };
  };
}

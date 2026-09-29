import { createRepositories } from "../../db/repositories/index.mjs";
import { readAccessRound } from "../../solana/registry-client.mjs";
import { callPublisherSigner, publisherSignerError } from "../publisher-signer.mjs";
import { effectiveAccessRoundState, hasTemporalAccessRoundState } from "../../domain/access-round-state.mjs";

/** Settles only the exact persisted round through the isolated publisher signer. */
export function createChainSettleHandler({ db, publisherSignerUrl, publisherSignerToken, rpcUrl, programId, fetchImpl = fetch, readAccessRoundImpl = readAccessRound, now = () => Date.now() }) {
  if (!db || !publisherSignerUrl || !publisherSignerToken || !rpcUrl || !programId) throw new Error("chain_settle_dependencies_required");
  const repositories = createRepositories(db);
  return async function settle(job) {
    const round = await repositories.accessRounds.findSettleable(job.payload.accessRoundId);
    if (!round) throw new Error("access_round_not_settleable");
    const effectiveState = effectiveAccessRoundState(round, now());
    if (hasTemporalAccessRoundState(round) && effectiveState !== round.state) {
      await repositories.accessRounds.advanceTemporalState(round.id, effectiveState);
    }
    if (effectiveState === "live") throw new Error("auction_still_open");
    if (effectiveState !== "ended") throw new Error("access_round_not_settleable");
    const { ok, payload: published } = await callPublisherSigner({ url: publisherSignerUrl, token: publisherSignerToken, action: "settle", body: { roundPda: round.round_pda }, fetchImpl });
    if (!ok) throw publisherSignerError(published);
    const chain = await readAccessRoundImpl({ rpcUrl, programId, roundPda: round.round_pda });
    if (!chain || chain.status !== 2) throw new Error("auction_settlement_not_finalized");
    const settlePatch = { state: "settled", bid_count: chain.bidCount, winners_count: chain.winnersCount, clearing_price_lamports: chain.clearingPriceLamports === 0 ? null : chain.clearingPriceLamports, slot: chain.slot, confirmation_status: "finalized", chain_state_source: "rpc_verified", decoded_state: { treasury: chain.treasury, bid_count: chain.bidCount, winners_count: chain.winnersCount, claimed_count: chain.claimedCount, clearing_price_lamports: chain.clearingPriceLamports }, last_reconciled_at: new Date() };
    const settleSignature = published.transaction?.signature ?? null;
    if (settleSignature) settlePatch.transaction_signature = settleSignature;
    await repositories.accessRounds.settleUpdate(round.id, settlePatch);
    return { accessRoundId: round.id, roundPda: round.round_pda, winnersCount: chain.winnersCount, clearingPriceLamports: chain.clearingPriceLamports, finalizedSlot: chain.slot, signature: published.transaction?.signature ?? null };
  };
}

import { datasetIdHash } from "../../domain/canonical-artifacts.mjs";
import { createRepositories } from "../../db/repositories/index.mjs";
import { callPublisherSigner, publisherSignerError } from "../publisher-signer.mjs";

function positive(value, name) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new Error(`invalid_${name}`); return number; }
function epoch(value, name) { const time = Date.parse(value); if (!Number.isFinite(time)) throw new Error(`invalid_${name}`); return Math.floor(time / 1_000); }

/** Calls only the isolated signer, then persists finalized program state. */
export function createChainPublishHandler({ db, publisherSignerUrl, publisherSignerToken, fetchImpl = fetch }) {
  if (!db || !publisherSignerUrl || !publisherSignerToken) throw new Error("chain_publish_dependencies_required");
  const repositories = createRepositories(db);
  return async function publish(job) {
    const packageRow = await repositories.packages.findById(job.payload.packageId);
    if (!packageRow || !["sealed", "commit_pending", "publication_failed", "committed"].includes(packageRow.status)) throw new Error("sealed_package_not_found");
    const version = await repositories.datasetVersions.findById(packageRow.dataset_version_id);
    const analysis = await repositories.analysisRuns.findById(packageRow.analysis_run_id);
    if (!version || version.status !== "sealed" || !analysis?.manifest_hash || !analysis.result_hash) throw new Error("package_inputs_not_sealed");
    const opensAt = epoch(job.payload.opensAt, "auction_open"); const closesAt = epoch(job.payload.closesAt, "auction_close"); if (closesAt <= opensAt) throw new Error("invalid_auction_window");
    const input = {
      datasetIdHash: datasetIdHash(version.dataset_id), version: version.version,
      rawSnapshotHash: Buffer.from(packageRow.raw_snapshot_hash).toString("hex"), normalizedDatasetHash: Buffer.from(packageRow.normalized_dataset_hash).toString("hex"),
      analysisManifestHash: Buffer.from(packageRow.analysis_manifest_hash).toString("hex"), analysisResultHash: Buffer.from(packageRow.analysis_result_hash).toString("hex"), accessPolicyHash: Buffer.from(packageRow.access_policy_hash).toString("hex"),
      maxSeats: packageRow.max_seats, allowedTierMask: packageRow.access_policy.allowed_tier_mask, delayedVersionLag: packageRow.access_policy.delayed.version_lag, delayedReleaseSeconds: Number(packageRow.access_policy.delayed.release_seconds), grantDurationSeconds: Number(packageRow.access_policy.expiry.grant_duration_seconds),
      opensAt, closesAt, minimumBidLamports: positive(job.payload.minimumBidLamports, "minimum_bid"), maxWinners: Math.min(positive(job.payload.maxWinners, "max_winners"), packageRow.max_seats, 10), enabledTierMask: packageRow.access_policy.allowed_tier_mask,
    };
    const { ok, payload: published } = await callPublisherSigner({ url: publisherSignerUrl, token: publisherSignerToken, action: "publish", body: input, fetchImpl });
    if (!ok) throw publisherSignerError(published);
    const finalTransaction = published.transactions?.at(-1);
    await repositories.packages.commitIfSealed(packageRow.id);
    await repositories.commitments.upsertForPackage(packageRow.id, { network: "devnet", program_id: process.env.SOLANA_PROGRAM_ID, dataset_pda: published.commitmentPda, transaction_signature: finalTransaction?.signature ?? null, slot: published.finalizedSlot, confirmation_status: "finalized", chain_state_source: "rpc_verified", decoded_account: { dataset_id_hash: input.datasetIdHash, version: input.version }, verified_at: new Date(), last_reconciled_at: new Date() });
    const state = opensAt > Math.floor(Date.now() / 1_000) ? "upcoming" : closesAt >= Math.floor(Date.now() / 1_000) ? "live" : "ended";
    await repositories.accessRounds.upsertForPackage(packageRow.id, { network: "devnet", program_id: process.env.SOLANA_PROGRAM_ID, round_pda: published.accessRoundPda, opens_at: new Date(opensAt * 1_000), closes_at: new Date(closesAt * 1_000), minimum_bid_lamports: input.minimumBidLamports, max_winners: input.maxWinners, enabled_tier_mask: input.enabledTierMask, settlement_rule: "top_n_pay_as_bid", state, transaction_signature: finalTransaction?.signature ?? null, slot: published.finalizedSlot, confirmation_status: "finalized", chain_state_source: "rpc_verified", decoded_state: { treasury: published.treasury, bid_count: 0, winners_count: 0, claimed_count: 0, clearing_price_lamports: 0 }, last_reconciled_at: new Date() });
    return { packageId: packageRow.id, commitmentPda: published.commitmentPda, accessRoundPda: published.accessRoundPda, finalizedSlot: published.finalizedSlot, signature: finalTransaction?.signature ?? null };
  };
}

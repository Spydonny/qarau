import { datasetIdHash } from "../../domain/canonical-artifacts.mjs";
import { createRepositories } from "../../db/repositories/index.mjs";

function positive(value, name) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new Error(`invalid_${name}`); return number; }
function epoch(value, name) { const time = Date.parse(value); if (!Number.isFinite(time)) throw new Error(`invalid_${name}`); return Math.floor(time / 1_000); }

/** Calls only the isolated signer, then persists finalized program state. */
export function createChainPublishHandler({ pool, publisherSignerUrl, publisherSignerToken }) {
  if (!pool || !publisherSignerUrl || !publisherSignerToken) throw new Error("chain_publish_dependencies_required");
  const repositories = createRepositories(pool);
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
    const response = await fetch(`${publisherSignerUrl.replace(/\/$/, "")}/publish`, { method: "POST", headers: { "content-type": "application/json", "x-publisher-token": publisherSignerToken }, body: JSON.stringify(input), signal: AbortSignal.timeout(60_000) });
    const published = await response.json(); if (!response.ok) throw new Error(published?.error ?? "publisher_signer_failed");
    const finalTransaction = published.transactions?.at(-1);
    await pool.query("UPDATE dataset_packages SET status = 'committed' WHERE id = $1 AND status IN ('sealed', 'commit_pending', 'publication_failed')", [packageRow.id]);
    await pool.query("INSERT INTO blockchain_commitments (package_id, network, program_id, dataset_pda, transaction_signature, slot, confirmation_status, chain_state_source, decoded_account, verified_at, last_reconciled_at) VALUES ($1, 'devnet', $2, $3, $4, $5, 'finalized', 'rpc_verified', $6, now(), now()) ON CONFLICT (package_id) DO UPDATE SET network = 'devnet', program_id = EXCLUDED.program_id, dataset_pda = EXCLUDED.dataset_pda, transaction_signature = EXCLUDED.transaction_signature, slot = EXCLUDED.slot, confirmation_status = 'finalized', chain_state_source = 'rpc_verified', decoded_account = EXCLUDED.decoded_account, verified_at = now(), last_reconciled_at = now()", [packageRow.id, process.env.SOLANA_PROGRAM_ID, published.commitmentPda, finalTransaction?.signature ?? null, published.finalizedSlot, { dataset_id_hash: input.datasetIdHash, version: input.version }]);
    const state = opensAt > Math.floor(Date.now() / 1_000) ? "upcoming" : closesAt >= Math.floor(Date.now() / 1_000) ? "live" : "ended";
    await pool.query("INSERT INTO access_rounds (package_id, network, program_id, round_pda, opens_at, closes_at, minimum_bid_lamports, max_winners, enabled_tier_mask, settlement_rule, state, transaction_signature, slot, confirmation_status, chain_state_source, decoded_state, last_reconciled_at) VALUES ($1, 'devnet', $2, $3, to_timestamp($4), to_timestamp($5), $6, $7, $8, 'top_n_pay_as_bid', $9, $10, $11, 'finalized', 'rpc_verified', $12, now()) ON CONFLICT (package_id) DO UPDATE SET network = 'devnet', program_id = EXCLUDED.program_id, round_pda = EXCLUDED.round_pda, state = EXCLUDED.state, transaction_signature = EXCLUDED.transaction_signature, slot = EXCLUDED.slot, confirmation_status = 'finalized', chain_state_source = 'rpc_verified', decoded_state = EXCLUDED.decoded_state, last_reconciled_at = now()", [packageRow.id, process.env.SOLANA_PROGRAM_ID, published.accessRoundPda, opensAt, closesAt, input.minimumBidLamports, input.maxWinners, input.enabledTierMask, state, finalTransaction?.signature ?? null, published.finalizedSlot, { treasury: published.treasury, bid_count: 0, winners_count: 0, claimed_count: 0, clearing_price_lamports: 0 }]);
    return { packageId: packageRow.id, commitmentPda: published.commitmentPda, accessRoundPda: published.accessRoundPda, finalizedSlot: published.finalizedSlot, signature: finalTransaction?.signature ?? null };
  };
}

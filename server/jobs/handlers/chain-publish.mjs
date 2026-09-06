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
    if (!packageRow || !["sealed", "commit_pending"].includes(packageRow.status)) throw new Error("sealed_package_not_found");
    const version = await repositories.datasetVersions.findById(packageRow.dataset_version_id);
    const analysis = await repositories.analysisRuns.findById(packageRow.analysis_run_id);
    if (!version || version.status !== "sealed" || !analysis?.manifest_hash || !analysis.result_hash) throw new Error("package_inputs_not_sealed");
    const startsAt = epoch(job.payload.startsAt, "sale_start"); const endsAt = epoch(job.payload.endsAt, "sale_end"); if (endsAt <= startsAt) throw new Error("invalid_sale_window");
    const input = {
      datasetIdHash: datasetIdHash(version.dataset_id), version: version.version,
      rawSnapshotHash: Buffer.from(packageRow.raw_snapshot_hash).toString("hex"), normalizedDatasetHash: Buffer.from(packageRow.normalized_dataset_hash).toString("hex"),
      analysisManifestHash: Buffer.from(packageRow.analysis_manifest_hash).toString("hex"), analysisResultHash: Buffer.from(packageRow.analysis_result_hash).toString("hex"), accessPolicyHash: Buffer.from(packageRow.access_policy_hash).toString("hex"),
      maxSeats: packageRow.max_seats, allowedTierMask: packageRow.access_policy.allowed_tier_mask, delayedVersionLag: packageRow.access_policy.delayed.version_lag, delayedReleaseSeconds: Number(packageRow.access_policy.delayed.release_seconds), grantDurationSeconds: Number(packageRow.access_policy.expiry.grant_duration_seconds),
      startsAt, endsAt, earlyPriceLamports: positive(job.payload.earlyPriceLamports, "early_price"), delayedPriceLamports: positive(job.payload.delayedPriceLamports, "delayed_price"), enabledTierMask: packageRow.access_policy.allowed_tier_mask,
    };
    const response = await fetch(`${publisherSignerUrl.replace(/\/$/, "")}/publish`, { method: "POST", headers: { "content-type": "application/json", "x-publisher-token": publisherSignerToken }, body: JSON.stringify(input), signal: AbortSignal.timeout(60_000) });
    const published = await response.json(); if (!response.ok) throw new Error(published?.error ?? "publisher_signer_failed");
    const finalTransaction = published.transactions?.at(-1);
    await pool.query("UPDATE dataset_packages SET status = 'committed' WHERE id = $1 AND status IN ('sealed', 'commit_pending')", [packageRow.id]);
    await pool.query("INSERT INTO blockchain_commitments (package_id, network, program_id, dataset_pda, transaction_signature, slot, confirmation_status, decoded_account, verified_at, last_reconciled_at) VALUES ($1, 'devnet', $2, $3, $4, $5, 'finalized', $6, now(), now()) ON CONFLICT (package_id) DO UPDATE SET transaction_signature = EXCLUDED.transaction_signature, slot = EXCLUDED.slot, confirmation_status = 'finalized', decoded_account = EXCLUDED.decoded_account, verified_at = now(), last_reconciled_at = now()", [packageRow.id, process.env.SOLANA_PROGRAM_ID, published.commitmentPda, finalTransaction?.signature ?? null, published.finalizedSlot, { dataset_id_hash: input.datasetIdHash, version: input.version }]);
    await pool.query("INSERT INTO sales (package_id, sale_pda, decoded_state, observed_slot, confirmation_status, stale_after, last_reconciled_at) VALUES ($1, $2, $3, $4, 'finalized', now() + interval '5 minutes', now()) ON CONFLICT (package_id) DO UPDATE SET decoded_state = EXCLUDED.decoded_state, observed_slot = EXCLUDED.observed_slot, confirmation_status = 'finalized', last_reconciled_at = now()", [packageRow.id, published.salePda, { treasury: published.treasury, starts_at: startsAt, ends_at: endsAt, early_price_lamports: input.earlyPriceLamports, delayed_price_lamports: input.delayedPriceLamports, occupied_seats: 0 }, published.finalizedSlot]);
    return { packageId: packageRow.id, commitmentPda: published.commitmentPda, salePda: published.salePda, finalizedSlot: published.finalizedSlot, signature: finalTransaction?.signature ?? null };
  };
}

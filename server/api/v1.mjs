import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { createRepositories } from "../db/repositories/index.mjs";
import { HASH_DOMAINS, canonicalJsonBytes, hashBytes, validateAccessPolicy } from "../domain/canonical-artifacts.mjs";
import { jobIdempotencyKey } from "../jobs/payloads.mjs";
import { PostgresJobQueue } from "../jobs/queue.mjs";
import { normalizeRows } from "../normalization/canonical-jsonl.mjs";
import { loadMarketTarget } from "../providers/real-data.mjs";
import { buildPurchaseTransaction, readAccessGrant, readDatasetCommitment, readFinalizedSignature, transactionTouchesPurchase } from "../solana/registry-client.mjs";
import { createSiwsService, formatSiwsMessage, requireWallet } from "../wallet/siws.mjs";

const OWNER_ACTOR_ID = process.env.QARAU_OWNER_ACTOR_ID ?? "00000000-0000-4000-8000-000000000001";
const NON_SENSITIVE_PUBLIC_FIELDS = new Set(["title", "description", "coverage", "update_frequency", "target_asset_class", "target_symbol", "alpha_score_summary", "validation_summary"]);

function hash(value) { return createHash("sha256").update(value).digest(); }
function streamBytes(stream) { return (async () => { const chunks = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks); })(); }
function nowIso() { return new Date().toISOString(); }
function errorStatus(error) {
  const message = String(error?.message ?? "operation_failed");
  if (/not_found|_not_found/.test(message)) return 404;
  if (/access_denied|wallet_unauthorized|grant_/.test(message)) return 403;
  if (/invalid|unsupported|required|unsafe|unavailable|not_sealed|not_complete|not_active|not_approved|conflict/.test(message)) return 400;
  return 500;
}
function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const status = errorStatus(error);
      // Keep internal details out of the response, but retain a safe code in
      // service logs so a failed durable operation can be diagnosed.
      console.error(JSON.stringify({ event: "v1_operation_failed", method: req.method, path: req.path, status, code: String(error?.message ?? "operation_failed").slice(0, 128) }));
      res.status(status).json({ error: status === 500 ? "operation_failed" : String(error.message) });
    }
  };
}
function validUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value)); }
function publicPackage(row) {
  const metadata = Object.fromEntries(Object.entries(row.public_metadata ?? {}).filter(([key]) => NON_SENSITIVE_PUBLIC_FIELDS.has(key)));
  return { package_id: row.id, ...metadata, commitment_address: row.dataset_pda, sale_address: row.sale_pda, max_seats: row.max_seats, occupied_seats: Number(row.decoded_state?.occupied_seats ?? 0), price_lamports: row.decoded_state?.early_price_lamports ?? null, sale_window: row.decoded_state?.starts_at && row.decoded_state?.ends_at ? { starts_at: row.decoded_state.starts_at, ends_at: row.decoded_state.ends_at } : null };
}

async function marketSnapshot({ pool, repositories, artifactStore, symbol }) {
  const data = await loadMarketTarget(symbol);
  const config = { "BTC-USD": { provider: "COINBASE", assetClass: "crypto", calendar: "24x7", currency: "USD" }, "ETH-USD": { provider: "COINBASE", assetClass: "crypto", calendar: "24x7", currency: "USD" } }[symbol] ?? { provider: "ECB", assetClass: "fx", calendar: "weekday", currency: "USD" };
  let target = (await pool.query("SELECT * FROM market_targets WHERE provider = $1 AND symbol = $2", [config.provider, data.symbol])).rows[0];
  if (!target) target = await repositories.marketTargets.create({ symbol: data.symbol, provider: config.provider, asset_class: config.assetClass, calendar: config.calendar, timezone: "UTC", currency: config.currency, status: "active" });
  const snapshotId = randomUUID();
  const rawBytes = Buffer.from(JSON.stringify(data.rows), "utf8");
  const rawHash = hashBytes(HASH_DOMAINS.rawSnapshot, rawBytes);
  const rawKey = `raw/markets/${target.id}/${snapshotId}/response.json`;
  await artifactStore.putOnce({ key: rawKey, bytes: rawBytes, artifactHash: rawHash, contentType: "application/json" });
  const normalized = normalizeRows(data.rows.map((row) => ({ timestamp: row.timestamp, availableAt: row.timestamp, values: { price: row.price } })), { valueFields: ["price"] });
  const normalizedKey = `normalized/markets/${target.id}/${snapshotId}/prices.jsonl`;
  await artifactStore.putOnce({ key: normalizedKey, bytes: normalized.bytes, artifactHash: normalized.hash, contentType: "application/x-ndjson" });
  const created = await repositories.marketSnapshots.create({ id: snapshotId, target_id: target.id, raw_object_key: rawKey, normalized_object_key: normalizedKey, raw_hash: Buffer.from(rawHash, "hex"), normalized_hash: Buffer.from(normalized.hash, "hex"), retrieved_at: new Date(data.retrievedAt), coverage_start: normalized.quality.coverage_start, coverage_end: normalized.quality.coverage_end });
  return { target, snapshot: created };
}

async function packageContext(pool, packageId) {
  const result = await pool.query(
    `SELECT package.*, version.dataset_id, version.version AS dataset_version, version.normalized_object_key,
            analysis.report_object_key, analysis.alpha_score, commitment.dataset_pda, commitment.program_id,
            sale.sale_pda, sale.decoded_state
     FROM dataset_packages AS package
     JOIN dataset_versions AS version ON version.id = package.dataset_version_id
     JOIN analysis_runs AS analysis ON analysis.id = package.analysis_run_id
     LEFT JOIN blockchain_commitments AS commitment ON commitment.package_id = package.id AND commitment.confirmation_status = 'finalized'
     LEFT JOIN sales AS sale ON sale.package_id = package.id AND sale.confirmation_status = 'finalized'
     WHERE package.id = $1`, [packageId],
  );
  return result.rows[0] ?? null;
}

async function chooseProtectedVersion(pool, context, grant) {
  const policy = context.access_policy;
  if (grant.tier === 1) return context;
  if (grant.tier !== 2) throw new Error("grant_tier_invalid");
  if (Math.floor(Date.now() / 1_000) < grant.grantedAt + Number(policy.delayed.release_seconds)) throw new Error("delayed_access_not_released");
  const requested = context.dataset_version - Number(policy.delayed.version_lag);
  const version = await pool.query("SELECT * FROM dataset_versions WHERE dataset_id = $1 AND version <= $2 AND status = 'sealed' ORDER BY version DESC LIMIT 1", [context.dataset_id, requested]);
  if (!version.rowCount) throw new Error("delayed_version_unavailable");
  return { ...context, normalized_object_key: version.rows[0].normalized_object_key, dataset_version: version.rows[0].version };
}

export function createV1Router({ pool, artifactStore, solana, ownerMiddleware, csrfMiddleware, publicOrigin }) {
  if (!pool || !artifactStore || !solana?.rpcUrl || !solana?.programId) throw new Error("v1_router_configuration_required");
  const repositories = createRepositories(pool);
  const queue = new PostgresJobQueue(pool);
  const origin = new URL(publicOrigin ?? "http://localhost:5173");
  const siws = createSiwsService({ pool, domain: origin.host, uri: origin.toString().replace(/\/$/, "") });
  const router = express.Router();
  const owner = express.Router();
  owner.use(ownerMiddleware, csrfMiddleware);

  owner.get("/sources", route(async (_req, res) => {
    const rows = await pool.query("SELECT id, domain, title, description, source_type, expected_fields, temporal_coverage, expected_update_interval, status, reliability, last_successful_ingestion_at, next_scrape_at, discovered_at FROM sources ORDER BY discovered_at DESC LIMIT 500");
    res.json({ sources: rows.rows });
  }));
  owner.get("/sources/:id", route(async (req, res) => {
    if (!validUuid(req.params.id)) throw new Error("invalid_source_id");
    const source = await repositories.sources.findById(req.params.id); if (!source) throw new Error("source_not_found");
    const runs = await pool.query("SELECT id, status, retrieved_at, record_count, change_type, parser_name, parser_version, error_code, created_at FROM ingestion_runs WHERE source_id = $1 ORDER BY created_at DESC LIMIT 100", [source.id]);
    const versions = await pool.query("SELECT id, dataset_id, version, status, quality_metrics, coverage_start, coverage_end, frequency, record_count, missing_rate, duplicate_rate, outlier_rate, continuity, sealed_at FROM dataset_versions WHERE dataset_id = (SELECT id FROM datasets WHERE source_id = $1) ORDER BY version DESC", [source.id]);
    const analyses = await pool.query("SELECT analysis.id, analysis.status, analysis.alpha_score, analysis.blocking_leakage, analysis.created_at, analysis.completed_at FROM analysis_runs AS analysis WHERE analysis.dataset_version_id IN (SELECT id FROM dataset_versions WHERE dataset_id = (SELECT id FROM datasets WHERE source_id = $1)) ORDER BY analysis.created_at DESC", [source.id]);
    res.json({ source: { ...source, canonical_url_ciphertext: undefined, canonical_url_hash: undefined }, ingestion_runs: runs.rows, versions: versions.rows, analysis_runs: analyses.rows });
  }));
  owner.post("/discovery/jobs", route(async (req, res) => {
    const queryGroup = String(req.body?.query_group ?? "general").toLowerCase();
    if (!/^[a-z]{3,40}$/.test(queryGroup)) throw new Error("invalid_discovery_query_group");
    const payload = { queryGroup, requestedBy: null, requestId: randomUUID() }; const job = await queue.enqueue({ type: "discovery.run", payload, idempotencyKey: jobIdempotencyKey("discovery.run", 1, payload), resourceType: "discovery" });
    res.status(202).json({ job: job.job, created: job.created });
  }));
  owner.post("/sources/:id/approve", route(async (req, res) => {
    if (!validUuid(req.params.id)) throw new Error("invalid_source_id");
    const changed = await pool.query("UPDATE sources SET status = 'active', next_scrape_at = COALESCE(next_scrape_at, now() + interval '1 hour'), license_status = CASE WHEN $2 THEN 'approved'::license_status ELSE license_status END, redistribution_rights = COALESCE($3, redistribution_rights), derivative_rights = COALESCE($4, derivative_rights), updated_at = now() WHERE id = $1 RETURNING id, status, next_scrape_at", [req.params.id, Boolean(req.body?.license_approved), typeof req.body?.redistribution_rights === "boolean" ? req.body.redistribution_rights : null, typeof req.body?.derivative_rights === "boolean" ? req.body.derivative_rights : null]);
    if (!changed.rowCount) throw new Error("source_not_found"); res.json({ source: changed.rows[0] });
  }));
  owner.post("/sources/:id/scrapes", route(async (req, res) => {
    if (!validUuid(req.params.id)) throw new Error("invalid_source_id");
    const source = await repositories.sources.findById(req.params.id); if (!source || source.status !== "active") throw new Error("source_not_active");
    await pool.query("UPDATE sources SET next_scrape_at = now() + interval '24 hours', updated_at = now() WHERE id = $1", [source.id]);
    const payload = { sourceId: source.id, reason: "manual", scheduledFor: nowIso() }; const job = await queue.enqueue({ type: "scrape.source", payload, idempotencyKey: jobIdempotencyKey("scrape.source", 1, payload), resourceType: "source", resourceId: source.id });
    res.status(202).json({ job: job.job, created: job.created });
  }));
  owner.post("/dataset-versions/:id/analysis-runs", route(async (req, res) => {
    if (!validUuid(req.params.id)) throw new Error("invalid_dataset_version_id");
    const version = await repositories.datasetVersions.findById(req.params.id); if (!version || version.status !== "sealed") throw new Error("dataset_version_not_sealed");
    const symbol = String(req.body?.target_symbol ?? "BTC-USD").toUpperCase();
    if (!["BTC-USD", "ETH-USD", "EURUSD", "EURGBP", "EURJPY", "EURCHF"].includes(symbol)) throw new Error("unsupported_market_target");
    const { target, snapshot } = await marketSnapshot({ pool, repositories, artifactStore, symbol });
    const existing = await pool.query("SELECT id FROM dataset_target_mappings WHERE dataset_id = $1 AND target_id = $2 ORDER BY mapping_version DESC LIMIT 1", [version.dataset_id, target.id]);
    const mapping = existing.rows[0] ?? await repositories.targetMappings.create({ dataset_id: version.dataset_id, target_id: target.id, physical_variable: (Array.isArray(version.schema_profile?.value_fields) ? version.schema_profile.value_fields : ["numeric_measurement"]).join(","), economic_mechanism: "Proposed physical-data relationship; quantitative validation required.", affected_asset: symbol, ai_rationale: "Local deterministic mapper proposed this target from public source metadata; it does not score alpha.", confidence: .25, status: "proposed", mapping_version: 1 });
    const run = await repositories.analysisRuns.create({ dataset_version_id: version.id, market_snapshot_id: snapshot.id, mapping_id: mapping.id, status: "queued", pipeline_version: "quantitative-v1" });
    const payload = { analysisRunId: run.id }; const job = await queue.enqueue({ type: "analysis.run", payload, idempotencyKey: jobIdempotencyKey("analysis.run", 1, payload), resourceType: "analysis_run", resourceId: run.id });
    res.status(202).json({ analysis_run: run, job: job.job, target, mapping });
  }));
  owner.get("/analysis-runs/:id", route(async (req, res) => {
    const run = await repositories.analysisRuns.findById(req.params.id); if (!run) throw new Error("analysis_run_not_found");
    const [signals, validations, checks, components] = await Promise.all([pool.query("SELECT * FROM signal_candidates WHERE analysis_run_id = $1", [run.id]), pool.query("SELECT * FROM validation_results WHERE analysis_run_id = $1", [run.id]), pool.query("SELECT * FROM leakage_check_results WHERE analysis_run_id = $1", [run.id]), pool.query("SELECT * FROM alpha_score_components WHERE analysis_run_id = $1", [run.id])]);
    res.json({ analysis_run: run, signal_candidates: signals.rows, validations: validations.rows, leakage_checks: checks.rows, alpha_score_components: components.rows });
  }));
  owner.post("/analysis-runs/:id/packages", route(async (req, res) => {
    const analysis = await repositories.analysisRuns.findById(req.params.id); if (!analysis || analysis.status !== "completed" || analysis.blocking_leakage) throw new Error("analysis_run_not_complete");
    const version = await repositories.datasetVersions.findById(analysis.dataset_version_id); const snapshot = await pool.query("SELECT * FROM source_snapshots WHERE id = $1", [version.source_snapshot_id]);
    if (!version || !snapshot.rowCount || !analysis.manifest_hash || !analysis.result_hash) throw new Error("package_inputs_not_sealed");
    const policy = validateAccessPolicy(req.body?.access_policy ?? { policy_version: 1, grant_scope: "PURCHASED_DATASET_LINE", allowed_tier_mask: 3, early: { available_immediately: true }, delayed: { version_lag: 1, release_seconds: "604800" }, expiry: { grant_duration_seconds: "2592000" } });
    const maxSeats = Number(req.body?.max_seats ?? 10); if (!Number.isInteger(maxSeats) || maxSeats < 1 || maxSeats > 10_000) throw new Error("invalid_max_seats");
    const source = await pool.query("SELECT title, description, expected_update_interval FROM sources WHERE id = (SELECT source_id FROM datasets WHERE id = $1)", [version.dataset_id]);
    const publicMetadata = { title: String(req.body?.title ?? source.rows[0]?.title ?? "Validated QARAU dataset").slice(0, 160), description: String(req.body?.description ?? source.rows[0]?.description ?? "Quantitatively validated external dataset.").slice(0, 500), coverage: { start: version.coverage_start, end: version.coverage_end }, update_frequency: version.frequency, alpha_score_summary: { score: Number(analysis.alpha_score), score_version: analysis.score_version }, validation_summary: { analysis_run_id: analysis.id } };
    const packageId = randomUUID(); const policyBytes = canonicalJsonBytes(policy); const policyHash = hashBytes(HASH_DOMAINS.accessPolicy, policyBytes);
    const privateBytes = Buffer.from(JSON.stringify({ package_id: packageId, dataset_version_id: version.id, analysis_run_id: analysis.id, created_at: nowIso() }), "utf8");
    const privateKey = `packages/${packageId}/private-metadata.json`; const policyKey = `packages/${packageId}/access-policy.json`;
    await artifactStore.putOnce({ key: privateKey, bytes: privateBytes, artifactHash: hash(privateBytes).toString("hex"), contentType: "application/json" });
    await artifactStore.putOnce({ key: policyKey, bytes: policyBytes, artifactHash: policyHash, contentType: "application/json" });
    const created = await repositories.packages.create({ id: packageId, dataset_version_id: version.id, analysis_run_id: analysis.id, status: "sealed", public_metadata: publicMetadata, private_metadata_object_key: privateKey, access_policy: policy, access_policy_object_key: policyKey, access_policy_hash: Buffer.from(policyHash, "hex"), max_seats: maxSeats, raw_snapshot_hash: snapshot.rows[0].raw_hash, normalized_dataset_hash: version.normalized_hash, analysis_manifest_hash: analysis.manifest_hash, analysis_result_hash: analysis.result_hash, sealed_at: new Date(), created_by: OWNER_ACTOR_ID });
    res.status(201).json({ package: created });
  }));
  owner.post("/packages/:id/publish", route(async (req, res) => {
    const packageRow = await repositories.packages.findById(req.params.id); if (!packageRow || packageRow.status !== "sealed") throw new Error("sealed_package_not_found");
    const startsAt = req.body?.starts_at ? new Date(req.body.starts_at) : new Date(Date.now() - 60_000);
    const endsAt = req.body?.ends_at ? new Date(req.body.ends_at) : new Date(Date.now() + 30 * 86_400_000);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) throw new Error("invalid_sale_window");
    const payload = { packageId: packageRow.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), earlyPriceLamports: Number(req.body?.early_price_lamports ?? 1_000_000), delayedPriceLamports: Number(req.body?.delayed_price_lamports ?? 500_000) };
    const job = await queue.enqueue({ type: "chain.publish", payload, idempotencyKey: jobIdempotencyKey("chain.publish", 1, payload), resourceType: "dataset_package", resourceId: packageRow.id });
    await pool.query("UPDATE dataset_packages SET status = 'commit_pending' WHERE id = $1 AND status = 'sealed'", [packageRow.id]);
    res.status(202).json({ job: job.job, created: job.created });
  }));
  owner.get("/jobs/:id", route(async (req, res) => { const job = await repositories.jobs.findById(req.params.id); if (!job) throw new Error("job_not_found"); res.json({ job }); }));

  // Contract paths are mounted at /api/v1; /owner is retained as a readable
  // console alias. Public routes never enter the owner middleware.
  const isOwnerPath = (path) => /^\/(?:sources(?:\/|$)|discovery\/jobs$|dataset-versions\/[^/]+\/analysis-runs$|analysis-runs(?:\/|$)|packages\/[^/]+\/publish$|jobs\/[^/]+$)/.test(path);
  router.use((req, res, next) => isOwnerPath(req.path) ? owner.handle(req, res, next) : next());
  router.use("/owner", owner);
  router.get("/marketplace", route(async (_req, res) => {
    const rows = await pool.query("SELECT package.*, commitment.dataset_pda, sale.sale_pda, sale.decoded_state FROM dataset_packages AS package JOIN blockchain_commitments AS commitment ON commitment.package_id = package.id AND commitment.confirmation_status = 'finalized' JOIN sales AS sale ON sale.package_id = package.id AND sale.confirmation_status = 'finalized' WHERE package.status = 'committed' ORDER BY package.created_at DESC");
    res.json({ packages: rows.rows.map(publicPackage) });
  }));
  router.get("/packages/:id/public", route(async (req, res) => { const context = await packageContext(pool, req.params.id); if (!context || context.status !== "committed" || !context.dataset_pda || !context.sale_pda) throw new Error("package_not_found"); res.json({ package: publicPackage(context) }); }));
  router.get("/packages/:id/proof", route(async (req, res) => {
    const context = await packageContext(pool, req.params.id); if (!context || !context.dataset_pda || !context.program_id) throw new Error("package_not_found");
    const chain = await readDatasetCommitment({ rpcUrl: solana.rpcUrl, programId: context.program_id, datasetPda: context.dataset_pda });
    const local = { raw_snapshot_hash: Buffer.from(context.raw_snapshot_hash).toString("hex"), normalized_dataset_hash: Buffer.from(context.normalized_dataset_hash).toString("hex"), analysis_manifest_hash: Buffer.from(context.analysis_manifest_hash).toString("hex"), analysis_result_hash: Buffer.from(context.analysis_result_hash).toString("hex"), access_policy_hash: Buffer.from(context.access_policy_hash).toString("hex") };
    const onchain = chain && { raw_snapshot_hash: chain.rawSnapshotHash, normalized_dataset_hash: chain.normalizedDatasetHash, analysis_manifest_hash: chain.analysisManifestHash, analysis_result_hash: chain.analysisResultHash, access_policy_hash: chain.accessPolicyHash };
    const matches = Boolean(onchain) && Object.entries(local).every(([key, value]) => onchain[key] === value);
    res.json({ status: !chain ? "UNAVAILABLE" : matches && chain.status === 1 ? "VERIFIED" : "MISMATCH", network: "devnet", program_id: context.program_id, dataset_pda: context.dataset_pda, onchain_hashes: onchain, local_hashes: local, matches, account_owner_valid: Boolean(chain), account_status_valid: chain?.status === 1, rpc_slot: chain?.slot ?? null, verified_at: nowIso() });
  }));
  router.post("/packages/:id/proof/verify", route(async (req, res) => { req.params.id = String(req.params.id); const context = await packageContext(pool, req.params.id); if (!context || !context.dataset_pda || !context.program_id) throw new Error("package_not_found"); const chain = await readDatasetCommitment({ rpcUrl: solana.rpcUrl, programId: context.program_id, datasetPda: context.dataset_pda }); const local = { raw_snapshot_hash: Buffer.from(context.raw_snapshot_hash).toString("hex"), normalized_dataset_hash: Buffer.from(context.normalized_dataset_hash).toString("hex"), analysis_manifest_hash: Buffer.from(context.analysis_manifest_hash).toString("hex"), analysis_result_hash: Buffer.from(context.analysis_result_hash).toString("hex"), access_policy_hash: Buffer.from(context.access_policy_hash).toString("hex") }; const onchain = chain && { raw_snapshot_hash: chain.rawSnapshotHash, normalized_dataset_hash: chain.normalizedDatasetHash, analysis_manifest_hash: chain.analysisManifestHash, analysis_result_hash: chain.analysisResultHash, access_policy_hash: chain.accessPolicyHash }; const matches = Boolean(onchain) && Object.entries(local).every(([key, value]) => onchain[key] === value); res.json({ status: !chain ? "UNAVAILABLE" : matches && chain.status === 1 ? "VERIFIED" : "MISMATCH", network: "devnet", program_id: context.program_id, dataset_pda: context.dataset_pda, onchain_hashes: onchain, local_hashes: local, matches, account_owner_valid: Boolean(chain), account_status_valid: chain?.status === 1, rpc_slot: chain?.slot ?? null, verified_at: nowIso() }); }));
  router.post("/auth/siws/challenge", route(async (req, res) => {
    const walletAddress = String(req.body?.address ?? "");
    if (!walletAddress) throw new Error("wallet_address_required");
    const challenge = await siws.challenge({ address: walletAddress });
    res.json({ ...challenge, message: formatSiwsMessage({ domain: challenge.domain, address: walletAddress, uri: challenge.uri, chainId: challenge.chain_id, nonce: challenge.nonce, issuedAt: challenge.issued_at, expirationTime: challenge.expiration_time }) });
  }));
  router.post("/auth/siws/verify", route(async (req, res) => { const result = await siws.verify({ address: String(req.body?.address ?? ""), nonce: req.body?.nonce, signature: req.body?.signature }); siws.setCookie(res, result.token); res.json({ wallet: result.wallet.address, issued_at: result.issued_at, expires_at: result.expires_at }); }));
  router.post("/auth/logout", route(async (req, res) => { await siws.logout(req); siws.clearCookie(res); res.json({ ok: true }); }));
  router.get("/auth/session", requireWallet(siws), (req, res) => res.json({ wallet: req.wallet.address, idle_expires_at: req.wallet.idle_expires_at, absolute_expires_at: req.wallet.absolute_expires_at }));

  const wallet = express.Router(); wallet.use(requireWallet(siws));
  wallet.post("/sales/:salePda/purchase-transaction", route(async (req, res) => {
    const tier = req.body?.tier === "delayed" ? 2 : req.body?.tier === "exclusive_early" ? 1 : 0; if (!tier) throw new Error("invalid_purchase_tier");
    const context = (await pool.query("SELECT package.*, commitment.dataset_pda, sale.sale_pda, sale.decoded_state FROM dataset_packages AS package JOIN blockchain_commitments AS commitment ON commitment.package_id = package.id AND commitment.confirmation_status = 'finalized' JOIN sales AS sale ON sale.package_id = package.id AND sale.confirmation_status = 'finalized' WHERE sale.sale_pda = $1 AND package.status = 'committed'", [req.params.salePda])).rows[0];
    if (!context || !context.decoded_state?.treasury) throw new Error("sale_not_found");
    const transaction = await buildPurchaseTransaction({ rpcUrl: solana.rpcUrl, programId: solana.programId, commitmentPda: context.dataset_pda, salePda: context.sale_pda, treasury: context.decoded_state.treasury, buyer: req.wallet.address, tier });
    res.json({ ...transaction, transaction_base64: transaction.transactionBase64, tier: tier === 1 ? "exclusive_early" : "delayed" });
  }));
  wallet.post("/purchases/confirm", route(async (req, res) => {
    const signature = String(req.body?.transaction_signature ?? "");
    const finalized = await readFinalizedSignature({ rpcUrl: solana.rpcUrl, signature }); if (!finalized) throw new Error("transaction_not_finalized");
    const candidates = await pool.query("SELECT package.id AS package_id, commitment.dataset_pda, commitment.program_id, sale.sale_pda, sale.decoded_state FROM dataset_packages AS package JOIN blockchain_commitments AS commitment ON commitment.package_id = package.id AND commitment.confirmation_status = 'finalized' JOIN sales AS sale ON sale.package_id = package.id AND sale.confirmation_status = 'finalized' WHERE package.status = 'committed'");
    for (const candidate of candidates.rows) {
      const grant = await readAccessGrant({ rpcUrl: solana.rpcUrl, programId: candidate.program_id, salePda: candidate.sale_pda, buyer: req.wallet.address });
      if (!grant || grant.datasetCommitment !== candidate.dataset_pda) continue;
      if (!await transactionTouchesPurchase({ rpcUrl: solana.rpcUrl, signature, programId: candidate.program_id, salePda: candidate.sale_pda, grantPda: grant.grantPda, buyer: req.wallet.address })) continue;
      const tier = grant.tier === 1 ? "exclusive_early" : "delayed";
      const lamports = Number(tier === "exclusive_early" ? candidate.decoded_state.early_price_lamports : candidate.decoded_state.delayed_price_lamports);
      if (!Number.isSafeInteger(lamports) || lamports < 1) throw new Error("invalid_sale_price");
      await pool.query("INSERT INTO purchases (transaction_signature, package_id, sale_pda, commitment_pda, grant_pda, wallet_id, tier, expected_lamports, decoded_lamports, observed_slot, finalized_slot, confirmation_status, validation_verdict) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $9, 'finalized', 'valid') ON CONFLICT (transaction_signature) DO NOTHING", [signature, candidate.package_id, candidate.sale_pda, candidate.dataset_pda, grant.grantPda, req.wallet.wallet_id, tier, lamports, finalized.slot]);
      await pool.query("INSERT INTO access_grant_cache (grant_pda, package_id, wallet_id, tier, granted_at, expires_at, status, transaction_signature, slot, last_reconciled_at) VALUES ($1, $2, $3, $4, to_timestamp($5), to_timestamp($6), 'active', $7, $8, now()) ON CONFLICT (grant_pda) DO UPDATE SET expires_at = EXCLUDED.expires_at, status = 'active', transaction_signature = EXCLUDED.transaction_signature, slot = EXCLUDED.slot, last_reconciled_at = now()", [grant.grantPda, candidate.package_id, req.wallet.wallet_id, tier, grant.grantedAt, grant.expiresAt, signature, finalized.slot]);
      res.json({ package_id: candidate.package_id, transaction_signature: signature, tier, grant_pda: grant.grantPda, status: "finalized" }); return;
    }
    throw new Error("purchase_grant_not_found");
  }));
  wallet.get("/wallet/access-grants", route(async (req, res) => { const sales = await pool.query("SELECT package_id, sale_pda FROM sales WHERE confirmation_status = 'finalized'"); const grants = []; for (const sale of sales.rows) { const grant = await readAccessGrant({ rpcUrl: solana.rpcUrl, programId: solana.programId, salePda: sale.sale_pda, buyer: req.wallet.address }); if (grant) grants.push({ package_id: sale.package_id, ...grant }); } res.json({ grants }); }));
  async function protectedContext(req) {
    const context = await packageContext(pool, req.params.packageId); if (!context || !context.dataset_pda || !context.sale_pda) throw new Error("package_not_found");
    const grant = await readAccessGrant({ rpcUrl: solana.rpcUrl, programId: context.program_id, salePda: context.sale_pda, buyer: req.wallet.address });
    if (!grant || grant.datasetCommitment !== context.dataset_pda) throw new Error("grant_access_denied");
    return { context: await chooseProtectedVersion(pool, context, grant), grant };
  }
  async function audited(req, action, resourceId, metadata = {}) { await repositories.audits.create({ actor_type: "wallet", actor_id: req.wallet.wallet_id, wallet_address: req.wallet.address, action, resource_type: "dataset_package", resource_id: resourceId, outcome: "allowed", metadata }); }
  wallet.get("/dataset/:packageId/metadata", route(async (req, res) => { const { context, grant } = await protectedContext(req); const bytes = await streamBytes(await artifactStore.getStream(context.private_metadata_object_key)); await audited(req, "dataset_metadata_read", context.id, { grant_pda: grant.grantPda }); res.type("application/json").send(bytes); }));
  wallet.get("/dataset/:packageId/report", route(async (req, res) => { const { context, grant } = await protectedContext(req); const bytes = await streamBytes(await artifactStore.getStream(context.report_object_key)); await audited(req, "dataset_report_read", context.id, { grant_pda: grant.grantPda }); res.type("application/json").send(bytes); }));
  wallet.get("/dataset/:packageId/:kind", route(async (req, res) => { if (!["data", "export"].includes(req.params.kind)) throw new Error("artifact_not_found"); const { context, grant } = await protectedContext(req); const stream = await artifactStore.getStream(context.normalized_object_key); await audited(req, req.params.kind === "export" ? "dataset_export" : "dataset_data_read", context.id, { grant_pda: grant.grantPda, dataset_version: context.dataset_version }); res.type("application/x-ndjson"); if (req.params.kind === "export") res.setHeader("Content-Disposition", `attachment; filename="qarau-${context.id}-v${context.dataset_version}.jsonl"`); stream.pipe(res); }));
  router.use(wallet);
  return router;
}

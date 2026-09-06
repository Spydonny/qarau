import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { createRepositories } from "../db/repositories/index.mjs";
import { HASH_DOMAINS, canonicalJsonBytes, hashBytes, validateAccessPolicy } from "../domain/canonical-artifacts.mjs";
import { jobIdempotencyKey } from "../jobs/payloads.mjs";
import { PostgresJobQueue } from "../jobs/queue.mjs";
import { normalizeRows } from "../normalization/canonical-jsonl.mjs";
import { loadMarketTarget } from "../providers/real-data.mjs";
import { buildBidTransaction, buildClaimEntitlementTransaction, buildRefundLosingBidTransaction, readAccessEntitlement, readAccessRound, readBid, readDatasetCommitment, readFinalizedSignature, transactionTouchesAccounts } from "../solana/registry-client.mjs";
import { createSiwsService, formatSiwsMessage, requireWallet } from "../wallet/siws.mjs";

const OWNER_ACTOR_ID = process.env.QARAU_OWNER_ACTOR_ID ?? "00000000-0000-4000-8000-000000000001";
const NON_SENSITIVE_PUBLIC_FIELDS = new Set(["title", "description", "coverage", "update_frequency", "target_asset_class", "target_symbol", "evidence_band", "validation_summary", "access_form"]);

function hash(value) { return createHash("sha256").update(value).digest(); }
function streamBytes(stream) { return (async () => { const chunks = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks); })(); }
function nowIso() { return new Date().toISOString(); }
function errorStatus(error) {
  const message = String(error?.message ?? "operation_failed");
  if (/not_found|_not_found/.test(message)) return 404;
  if (/access_denied|wallet_unauthorized|grant_/.test(message)) return 403;
  if (/invalid|unsupported|required|unsafe|unavailable|not_sealed|not_complete|not_active|not_approved|not_settled|not_settleable|still_open|not_open|below_minimum|tier_not_enabled|screening_failed|conflict/.test(message)) return 400;
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
function pageQuery(query) {
  const requestedLimit = Number.parseInt(String(query?.limit ?? "20"), 10);
  const requestedOffset = Number.parseInt(String(query?.offset ?? "0"), 10);
  return {
    limit: Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 20,
    offset: Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0,
  };
}
function publicPackage(row) {
  const metadata = Object.fromEntries(Object.entries(row.public_metadata ?? {}).filter(([key]) => NON_SENSITIVE_PUBLIC_FIELDS.has(key)));
  return {
    package_id: row.id,
    ...metadata,
    commitment_address: row.dataset_pda,
    access_round_address: row.round_pda,
    access_round_id: row.access_round_id,
    access_round: row.round_pda ? {
      state: row.round_state,
      opens_at: row.opens_at,
      closes_at: row.closes_at,
      minimum_bid_lamports: Number(row.minimum_bid_lamports),
      max_winners: row.max_winners,
      bid_count: row.bid_count,
      winners_count: row.winners_count,
      clearing_price_lamports: row.clearing_price_lamports == null ? null : Number(row.clearing_price_lamports),
      settlement_rule: row.settlement_rule,
    } : null,
  };
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
            round.id AS access_round_id, round.round_pda, round.state AS round_state, round.opens_at, round.closes_at,
            round.minimum_bid_lamports, round.max_winners, round.bid_count, round.winners_count,
            round.clearing_price_lamports, round.settlement_rule, round.decoded_state,
            source.redistribution_rights, source.derivative_rights,
            (SELECT candidate.artifact_object_key FROM signal_candidates AS candidate
             WHERE candidate.analysis_run_id = analysis.id
             ORDER BY candidate.id LIMIT 1) AS derived_signal_object_key
     FROM dataset_packages AS package
     JOIN dataset_versions AS version ON version.id = package.dataset_version_id
     JOIN datasets AS dataset ON dataset.id = version.dataset_id
     JOIN sources AS source ON source.id = dataset.source_id
     JOIN analysis_runs AS analysis ON analysis.id = package.analysis_run_id
     LEFT JOIN blockchain_commitments AS commitment ON commitment.package_id = package.id AND commitment.confirmation_status = 'finalized'
     LEFT JOIN access_rounds AS round ON round.package_id = package.id AND round.confirmation_status = 'finalized'
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
    const rows = await pool.query("SELECT source.id, source.domain, source.title, source.description, source.source_type, source.expected_fields, source.temporal_coverage, source.expected_update_interval, source.status, source.reliability, source.license_status, source.redistribution_rights, source.derivative_rights, source.last_successful_ingestion_at, source.next_scrape_at, source.discovered_at, screening.score AS screening_score, screening.passed AS screening_passed, screening.rejection_reasons FROM sources AS source LEFT JOIN source_screenings AS screening ON screening.source_id = source.id ORDER BY source.discovered_at DESC LIMIT 500");
    res.json({ sources: rows.rows });
  }));
  owner.get("/sources/:id", route(async (req, res) => {
    if (!validUuid(req.params.id)) throw new Error("invalid_source_id");
    const source = await repositories.sources.findById(req.params.id); if (!source) throw new Error("source_not_found");
    const runs = await pool.query("SELECT id, status, retrieved_at, record_count, change_type, parser_name, parser_version, error_code, created_at FROM ingestion_runs WHERE source_id = $1 ORDER BY created_at DESC LIMIT 100", [source.id]);
    const versions = await pool.query("SELECT id, dataset_id, version, status, quality_metrics, coverage_start, coverage_end, frequency, record_count, missing_rate, duplicate_rate, outlier_rate, continuity, sealed_at FROM dataset_versions WHERE dataset_id = (SELECT id FROM datasets WHERE source_id = $1) ORDER BY version DESC", [source.id]);
    const analyses = await pool.query("SELECT analysis.id, analysis.status, analysis.alpha_score, analysis.blocking_leakage, analysis.created_at, analysis.completed_at FROM analysis_runs AS analysis WHERE analysis.dataset_version_id IN (SELECT id FROM dataset_versions WHERE dataset_id = (SELECT id FROM datasets WHERE source_id = $1)) ORDER BY analysis.created_at DESC", [source.id]);
    const screening = await pool.query("SELECT gates, score, passed, rejection_reasons, screened_at FROM source_screenings WHERE source_id = $1", [source.id]);
    res.json({ source: { ...source, canonical_url_ciphertext: undefined, canonical_url_hash: undefined, screening: screening.rows[0] ?? null }, ingestion_runs: runs.rows, versions: versions.rows, analysis_runs: analyses.rows });
  }));
  owner.post("/discovery/jobs", route(async (req, res) => {
    const queryGroup = String(req.body?.query_group ?? "general").toLowerCase();
    if (!/^[a-z]{3,40}$/.test(queryGroup)) throw new Error("invalid_discovery_query_group");
    const payload = { queryGroup, requestedBy: null, requestId: randomUUID() }; const job = await queue.enqueue({ type: "discovery.run", payload, idempotencyKey: jobIdempotencyKey("discovery.run", 1, payload), resourceType: "discovery" });
    res.status(202).json({ job: job.job, created: job.created });
  }));
  owner.post("/sources/:id/approve", route(async (req, res) => {
    if (!validUuid(req.params.id)) throw new Error("invalid_source_id");
    const screening = await pool.query("SELECT passed FROM source_screenings WHERE source_id = $1", [req.params.id]);
    if (!screening.rows[0]?.passed) throw new Error("source_screening_failed");
    const redistribution = req.body?.redistribution_rights === true;
    const derivative = req.body?.derivative_rights === true;
    if (req.body?.license_approved !== true || (!redistribution && !derivative)) throw new Error("invalid_license_decision");
    const changed = await pool.query("UPDATE sources SET status = 'active', next_scrape_at = COALESCE(next_scrape_at, now() + interval '1 hour'), license_status = 'approved', redistribution_rights = $2, derivative_rights = $3, license_reviewed_by = $4, license_reviewed_at = now(), updated_at = now() WHERE id = $1 RETURNING id, status, next_scrape_at, license_status, redistribution_rights, derivative_rights", [req.params.id, redistribution, derivative, OWNER_ACTOR_ID]);
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
    if (!validUuid(req.params.id)) throw new Error("invalid_analysis_run_id");
    const run = await repositories.analysisRuns.findById(req.params.id); if (!run) throw new Error("analysis_run_not_found");
    const { limit, offset } = pageQuery(req.query);
    const [signals, signalCount, checks, components, packageResult] = await Promise.all([
      pool.query("SELECT * FROM signal_candidates WHERE analysis_run_id = $1 ORDER BY source_column, transformation, lag, horizon, id LIMIT $2 OFFSET $3", [run.id, limit, offset]),
      pool.query("SELECT COUNT(*)::int AS total FROM signal_candidates WHERE analysis_run_id = $1", [run.id]),
      pool.query("SELECT check_type, status, COUNT(*)::int AS count, COALESCE(SUM(score_penalty), 0)::double precision AS score_penalty, MIN(explanation) AS explanation FROM leakage_check_results WHERE analysis_run_id = $1 GROUP BY check_type, status ORDER BY check_type, status", [run.id]),
      pool.query("SELECT * FROM alpha_score_components WHERE analysis_run_id = $1 ORDER BY component", [run.id]),
      pool.query("SELECT id, status, public_metadata, max_seats, sealed_at, created_at FROM dataset_packages WHERE analysis_run_id = $1 ORDER BY created_at DESC LIMIT 1", [run.id]),
    ]);
    const signalIds = signals.rows.map(({ id }) => id);
    const validations = signalIds.length
      ? await pool.query("SELECT * FROM validation_results WHERE analysis_run_id = $1 AND signal_candidate_id = ANY($2::uuid[]) AND split = 'test' ORDER BY signal_candidate_id, id", [run.id, signalIds])
      : { rows: [] };
    const total = Number(signalCount.rows[0]?.total ?? 0);
    res.json({
      analysis_run: run,
      signal_candidates: signals.rows,
      validations: validations.rows,
      leakage_checks: checks.rows,
      alpha_score_components: components.rows,
      package: packageResult.rows[0] ?? null,
      pagination: { limit, offset, total, has_previous: offset > 0, has_next: offset + signals.rows.length < total },
    });
  }));
  owner.post("/analysis-runs/:id/packages", route(async (req, res) => {
    if (!validUuid(req.params.id)) throw new Error("invalid_analysis_run_id");
    const analysis = await repositories.analysisRuns.findById(req.params.id); if (!analysis || analysis.status !== "completed" || analysis.blocking_leakage) throw new Error("analysis_run_not_complete");
    const existing = await pool.query("SELECT * FROM dataset_packages WHERE analysis_run_id = $1 ORDER BY created_at DESC LIMIT 1", [analysis.id]);
    if (existing.rowCount) return res.json({ package: existing.rows[0], existing: true });
    const version = await repositories.datasetVersions.findById(analysis.dataset_version_id);
    if (!version) throw new Error("package_inputs_not_sealed");
    const snapshot = await pool.query("SELECT * FROM source_snapshots WHERE id = $1", [version.source_snapshot_id]);
    if (!snapshot.rowCount || !analysis.manifest_hash || !analysis.result_hash) throw new Error("package_inputs_not_sealed");
    const policy = validateAccessPolicy(req.body?.access_policy ?? { policy_version: 1, grant_scope: "PURCHASED_DATASET_LINE", allowed_tier_mask: 3, early: { available_immediately: true }, delayed: { version_lag: 1, release_seconds: "604800" }, expiry: { grant_duration_seconds: "2592000" } });
    const maxSeats = Number(req.body?.max_seats ?? 10); if (!Number.isInteger(maxSeats) || maxSeats < 1 || maxSeats > 10_000) throw new Error("invalid_max_seats");
    const source = await pool.query("SELECT title, description, expected_update_interval, license_status, redistribution_rights, derivative_rights FROM sources WHERE id = (SELECT source_id FROM datasets WHERE id = $1)", [version.dataset_id]);
    const rights = source.rows[0];
    if (rights?.license_status !== "approved" || (!rights.redistribution_rights && !rights.derivative_rights)) throw new Error("package_license_not_approved");
    const evidenceBand = Number(analysis.alpha_score) >= 75 ? "strong" : Number(analysis.alpha_score) >= 50 ? "moderate" : Number(analysis.alpha_score) >= 25 ? "weak" : "rejected";
    const publicMetadata = { title: String(req.body?.title ?? rights?.title ?? "Validated QARAU dataset").slice(0, 160), description: String(req.body?.description ?? rights?.description ?? "Quantitatively validated external dataset.").slice(0, 500), coverage: { start: version.coverage_start, end: version.coverage_end }, update_frequency: version.frequency, evidence_band: evidenceBand, access_form: rights.redistribution_rights ? "normalized_and_derived" : "derived_only", validation_summary: { analysis_run_id: analysis.id } };
    const packageId = randomUUID(); const policyBytes = canonicalJsonBytes(policy); const policyHash = hashBytes(HASH_DOMAINS.accessPolicy, policyBytes);
    const privateBytes = Buffer.from(JSON.stringify({ package_id: packageId, dataset_version_id: version.id, analysis_run_id: analysis.id, created_at: nowIso() }), "utf8");
    const privateKey = `packages/${packageId}/private-metadata.json`; const policyKey = `packages/${packageId}/access-policy.json`;
    await artifactStore.putOnce({ key: privateKey, bytes: privateBytes, artifactHash: hash(privateBytes).toString("hex"), contentType: "application/json" });
    await artifactStore.putOnce({ key: policyKey, bytes: policyBytes, artifactHash: policyHash, contentType: "application/json" });
    const created = await repositories.packages.create({ id: packageId, dataset_version_id: version.id, analysis_run_id: analysis.id, status: "sealed", public_metadata: publicMetadata, private_metadata_object_key: privateKey, access_policy: policy, access_policy_object_key: policyKey, access_policy_hash: Buffer.from(policyHash, "hex"), max_seats: maxSeats, raw_snapshot_hash: snapshot.rows[0].raw_hash, normalized_dataset_hash: version.normalized_hash, analysis_manifest_hash: analysis.manifest_hash, analysis_result_hash: analysis.result_hash, sealed_at: new Date(), created_by: OWNER_ACTOR_ID });
    res.status(201).json({ package: created, existing: false });
  }));
  owner.post("/packages/:id/publish", route(async (req, res) => {
    if (!validUuid(req.params.id)) throw new Error("invalid_package_id");
    const packageRow = await repositories.packages.findById(req.params.id);
    if (!packageRow || !["sealed", "publication_failed", "commit_pending", "committed"].includes(packageRow.status)) throw new Error("sealed_package_not_found");
    const existingRound = await pool.query("SELECT id FROM access_rounds WHERE package_id = $1", [packageRow.id]);
    if (existingRound.rowCount) throw new Error("access_round_conflict");
    const active = await pool.query("SELECT * FROM jobs WHERE type = 'chain.publish' AND resource_type = 'dataset_package' AND resource_id = $1 AND status IN ('queued', 'running', 'retry_wait') ORDER BY created_at DESC LIMIT 1", [packageRow.id]);
    if (active.rowCount) return res.status(202).json({ job: active.rows[0], created: false });
    const previous = await pool.query("SELECT payload FROM jobs WHERE type = 'chain.publish' AND resource_type = 'dataset_package' AND resource_id = $1 ORDER BY created_at DESC LIMIT 1", [packageRow.id]);
    const previousPayload = previous.rows[0]?.payload;
    const opensAt = req.body?.opens_at ? new Date(req.body.opens_at) : new Date(previousPayload?.opensAt ?? Date.now() - 60_000);
    const closesAt = req.body?.closes_at ? new Date(req.body.closes_at) : new Date(previousPayload?.closesAt ?? Date.now() + 24 * 60 * 60_000);
    if (!Number.isFinite(opensAt.getTime()) || !Number.isFinite(closesAt.getTime()) || closesAt <= opensAt || closesAt.getTime() <= Date.now()) throw new Error("invalid_auction_window");
    const minimumBidLamports = Number(req.body?.minimum_bid_lamports ?? previousPayload?.minimumBidLamports ?? 500_000);
    const maxWinners = Number(req.body?.max_winners ?? previousPayload?.maxWinners ?? Math.min(packageRow.max_seats, 10));
    if (!Number.isSafeInteger(minimumBidLamports) || minimumBidLamports < 1 || !Number.isInteger(maxWinners) || maxWinners < 1 || maxWinners > Math.min(packageRow.max_seats, 10)) throw new Error("invalid_auction_terms");
    const payload = { packageId: packageRow.id, opensAt: opensAt.toISOString(), closesAt: closesAt.toISOString(), minimumBidLamports, maxWinners };
    const job = await queue.enqueue({ type: "chain.publish", payload, idempotencyKey: `${jobIdempotencyKey("chain.publish", 2, payload)}:${randomUUID()}`, resourceType: "dataset_package", resourceId: packageRow.id });
    await pool.query("UPDATE dataset_packages SET status = 'commit_pending' WHERE id = $1 AND status IN ('sealed', 'publication_failed')", [packageRow.id]);
    res.status(202).json({ job: job.job, created: job.created });
  }));
  owner.post("/access-rounds/:id/settle", route(async (req, res) => {
    if (!validUuid(req.params.id)) throw new Error("invalid_access_round_id");
    const round = (await pool.query("SELECT * FROM access_rounds WHERE id = $1", [req.params.id])).rows[0];
    if (!round || !["live", "ended"].includes(round.state)) throw new Error("access_round_not_settleable");
    if (new Date(round.closes_at).getTime() >= Date.now()) throw new Error("auction_still_open");
    const payload = { accessRoundId: round.id };
    const job = await queue.enqueue({ type: "chain.settle", payload, idempotencyKey: jobIdempotencyKey("chain.settle", 1, payload), resourceType: "access_round", resourceId: round.id });
    res.status(202).json({ job: job.job, created: job.created });
  }));
  owner.get("/cockpit/funnel", route(async (_req, res) => {
    const rows = await pool.query(`SELECT source.id, COALESCE(source.title, source.domain) AS name, source.source_type,
      COALESCE(source.reliability->>'category', 'external') AS category,
      COALESCE(source.reliability->>'region', 'global') AS region,
      screening.score, screening.passed,
      version.id AS version_id, version.frequency, version.continuity,
      analysis.id AS analysis_id, analysis.alpha_score, analysis.status AS analysis_status,
      package.id AS package_id, round.id AS round_id
      FROM sources AS source
      LEFT JOIN source_screenings AS screening ON screening.source_id = source.id
      LEFT JOIN datasets AS dataset ON dataset.source_id = source.id
      LEFT JOIN LATERAL (SELECT * FROM dataset_versions WHERE dataset_id = dataset.id ORDER BY version DESC LIMIT 1) AS version ON true
      LEFT JOIN LATERAL (SELECT * FROM analysis_runs WHERE dataset_version_id = version.id ORDER BY created_at DESC LIMIT 1) AS analysis ON true
      LEFT JOIN LATERAL (SELECT * FROM dataset_packages WHERE analysis_run_id = analysis.id ORDER BY created_at DESC LIMIT 1) AS package ON true
      LEFT JOIN access_rounds AS round ON round.package_id = package.id
      ORDER BY source.discovered_at DESC LIMIT 40`);
    const labels = ["DISCOVERED", "SCREENED", "INGESTED", "VALIDATED", "PUBLISHED"];
    const lanes = rows.rows.map((row, rank) => {
      const reachedStage = row.round_id ? 4 : row.package_id || row.analysis_status === "completed" ? 3 : row.version_id ? 2 : row.passed ? 1 : 0;
      return { id: row.id, rank, survived: Boolean(row.round_id), diedAt: row.round_id ? null : reachedStage, diedAtLabel: row.round_id ? null : labels[reachedStage], reachedStage, signalId: row.analysis_id, ic: Number(row.alpha_score ?? 0) / 100, lag: 0, stability: Number(row.continuity ?? 0), reason: row.passed === false ? "Screening gates not met" : null, seed: rank, dataset: { id: String(row.id).slice(0, 8).toUpperCase(), name: row.name, category: row.category, sourceType: row.source_type, region: row.region, frequency: row.frequency ?? "—", historyYears: 0, quality: Number(row.score ?? 0) / 10, site: { city: "—", country: row.region, lat: 0, lon: 0 }, coverage: "—" } };
    });
    const stageCounts = labels.map((_, stage) => lanes.filter((lane) => lane.reachedStage >= stage).length);
    res.json({ runId: "production-funnel", target: "QARAU evidence pipeline", stageLabels: labels, stageCounts, sampled: lanes.length, tested: Number(stageCounts[0] ?? 0), lanes });
  }));
  owner.get("/jobs/:id", route(async (req, res) => { const job = await repositories.jobs.findById(req.params.id); if (!job) throw new Error("job_not_found"); res.json({ job }); }));

  // Contract paths are mounted at /api/v1; /owner is retained as a readable
  // console alias. Public routes never enter the owner middleware.
  const isOwnerPath = (path) => /^\/(?:sources(?:\/|$)|discovery\/jobs$|dataset-versions\/[^/]+\/analysis-runs$|analysis-runs(?:\/|$)|packages\/[^/]+\/publish$|access-rounds\/[^/]+\/settle$|cockpit\/funnel$|jobs\/[^/]+$)/.test(path);
  router.use((req, res, next) => isOwnerPath(req.path) ? owner.handle(req, res, next) : next());
  router.use("/owner", owner);
  router.get("/opportunities", route(async (_req, res) => {
    const rows = await pool.query("SELECT package.*, commitment.dataset_pda, round.id AS access_round_id, round.round_pda, round.state AS round_state, round.opens_at, round.closes_at, round.minimum_bid_lamports, round.max_winners, round.bid_count, round.winners_count, round.clearing_price_lamports, round.settlement_rule FROM dataset_packages AS package JOIN blockchain_commitments AS commitment ON commitment.package_id = package.id AND commitment.confirmation_status = 'finalized' JOIN access_rounds AS round ON round.package_id = package.id AND round.confirmation_status = 'finalized' WHERE package.status = 'committed' ORDER BY package.created_at DESC");
    res.json({ packages: rows.rows.map(publicPackage) });
  }));
  router.get("/opportunities/:id", route(async (req, res) => { const context = await packageContext(pool, req.params.id); if (!context || context.status !== "committed" || !context.dataset_pda || !context.round_pda) throw new Error("package_not_found"); res.json({ package: publicPackage(context) }); }));
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
  const tierNumber = (value) => value === "delayed" ? 2 : value === "exclusive_early" ? 1 : 0;
  const tierName = (value) => value === 1 ? "exclusive_early" : value === 2 ? "delayed" : null;
  wallet.post("/access-rounds/:roundPda/bid-transaction", route(async (req, res) => {
    const tier = tierNumber(req.body?.tier); if (!tier) throw new Error("invalid_bid_tier");
    const amountLamports = Number(req.body?.amount_lamports);
    const local = (await pool.query("SELECT * FROM access_rounds WHERE round_pda = $1 AND confirmation_status = 'finalized'", [req.params.roundPda])).rows[0];
    if (!local) throw new Error("access_round_not_found");
    const chain = await readAccessRound({ rpcUrl: solana.rpcUrl, programId: local.program_id, roundPda: local.round_pda });
    const now = Math.floor(Date.now() / 1_000);
    if (!chain || chain.status !== 1 || now < chain.opensAt || now > chain.closesAt) throw new Error("auction_not_active");
    if (!Number.isSafeInteger(amountLamports) || amountLamports < chain.minimumBidLamports) throw new Error("bid_below_minimum");
    if ((chain.enabledTierMask & tier) === 0) throw new Error("bid_tier_not_enabled");
    const transaction = await buildBidTransaction({ rpcUrl: solana.rpcUrl, programId: local.program_id, roundPda: local.round_pda, bidder: req.wallet.address, amountLamports, tier });
    res.json({ ...transaction, transaction_base64: transaction.transactionBase64, tier: tierName(tier) });
  }));
  wallet.post("/bids/confirm", route(async (req, res) => {
    const signature = String(req.body?.transaction_signature ?? "");
    const roundPda = String(req.body?.round_pda ?? "");
    const finalized = await readFinalizedSignature({ rpcUrl: solana.rpcUrl, signature }); if (!finalized) throw new Error("transaction_not_finalized");
    const local = (await pool.query("SELECT round.*, package.id AS package_id FROM access_rounds AS round JOIN dataset_packages AS package ON package.id = round.package_id WHERE round.round_pda = $1", [roundPda])).rows[0];
    if (!local) throw new Error("access_round_not_found");
    const bid = await readBid({ rpcUrl: solana.rpcUrl, programId: local.program_id, roundPda, bidder: req.wallet.address });
    if (!bid || !await transactionTouchesAccounts({ rpcUrl: solana.rpcUrl, signature, required: [local.program_id, roundPda, bid.bidPda, req.wallet.address] })) throw new Error("bid_not_found");
    const tier = tierName(bid.tier); if (!tier) throw new Error("invalid_bid_tier");
    await pool.query("INSERT INTO auction_bids (access_round_id, bid_pda, wallet_id, amount_lamports, tier, status, transaction_signature, observed_slot, placed_at, last_reconciled_at) VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, to_timestamp($8), now()) ON CONFLICT (access_round_id, wallet_id) DO UPDATE SET amount_lamports = EXCLUDED.amount_lamports, tier = EXCLUDED.tier, transaction_signature = EXCLUDED.transaction_signature, observed_slot = EXCLUDED.observed_slot, placed_at = EXCLUDED.placed_at, last_reconciled_at = now()", [local.id, bid.bidPda, req.wallet.wallet_id, bid.amountLamports, tier, signature, finalized.slot, bid.placedAt]);
    await pool.query("UPDATE access_rounds SET bid_count = GREATEST(bid_count, $2), last_reconciled_at = now() WHERE id = $1", [local.id, (await readAccessRound({ rpcUrl: solana.rpcUrl, programId: local.program_id, roundPda }))?.bidCount ?? 0]);
    res.json({ package_id: local.package_id, round_pda: roundPda, bid_pda: bid.bidPda, amount_lamports: bid.amountLamports, tier, status: "finalized" });
  }));
  wallet.post("/access-rounds/:roundPda/claim-transaction", route(async (req, res) => {
    const local = (await pool.query("SELECT round.*, commitment.dataset_pda FROM access_rounds AS round JOIN blockchain_commitments AS commitment ON commitment.package_id = round.package_id AND commitment.confirmation_status = 'finalized' WHERE round.round_pda = $1 AND round.state IN ('settled', 'access_granted')", [req.params.roundPda])).rows[0];
    if (!local?.decoded_state?.treasury) throw new Error("access_round_not_settled");
    const transaction = await buildClaimEntitlementTransaction({ rpcUrl: solana.rpcUrl, programId: local.program_id, commitmentPda: local.dataset_pda, roundPda: local.round_pda, treasury: local.decoded_state.treasury, bidder: req.wallet.address });
    res.json({ ...transaction, transaction_base64: transaction.transactionBase64 });
  }));
  wallet.post("/entitlements/confirm", route(async (req, res) => {
    const signature = String(req.body?.transaction_signature ?? ""); const roundPda = String(req.body?.round_pda ?? "");
    const finalized = await readFinalizedSignature({ rpcUrl: solana.rpcUrl, signature }); if (!finalized) throw new Error("transaction_not_finalized");
    const local = (await pool.query("SELECT round.*, commitment.dataset_pda FROM access_rounds AS round JOIN blockchain_commitments AS commitment ON commitment.package_id = round.package_id AND commitment.confirmation_status = 'finalized' WHERE round.round_pda = $1", [roundPda])).rows[0];
    if (!local) throw new Error("access_round_not_found");
    const entitlement = await readAccessEntitlement({ rpcUrl: solana.rpcUrl, programId: local.program_id, roundPda, wallet: req.wallet.address });
    if (!entitlement || entitlement.datasetCommitment !== local.dataset_pda || !await transactionTouchesAccounts({ rpcUrl: solana.rpcUrl, signature, required: [local.program_id, roundPda, entitlement.entitlementPda, req.wallet.address] })) throw new Error("entitlement_not_found");
    const tier = tierName(entitlement.tier); if (!tier) throw new Error("invalid_entitlement_tier");
    await pool.query("INSERT INTO access_entitlement_cache (entitlement_pda, access_round_id, package_id, wallet_id, tier, bid_amount_lamports, granted_at, expires_at, status, transaction_signature, slot, last_reconciled_at) VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7), to_timestamp($8), 'active', $9, $10, now()) ON CONFLICT (entitlement_pda) DO UPDATE SET expires_at = EXCLUDED.expires_at, status = 'active', transaction_signature = EXCLUDED.transaction_signature, slot = EXCLUDED.slot, last_reconciled_at = now()", [entitlement.entitlementPda, local.id, local.package_id, req.wallet.wallet_id, tier, entitlement.bidAmountLamports, entitlement.grantedAt, entitlement.expiresAt, signature, finalized.slot]);
    await pool.query("UPDATE auction_bids SET status = 'claimed', last_reconciled_at = now() WHERE access_round_id = $1 AND wallet_id = $2", [local.id, req.wallet.wallet_id]);
    await pool.query("UPDATE access_rounds SET state = 'access_granted', last_reconciled_at = now() WHERE id = $1", [local.id]);
    res.json({ package_id: local.package_id, round_pda: roundPda, entitlement_pda: entitlement.entitlementPda, tier, status: "finalized" });
  }));
  wallet.post("/access-rounds/:roundPda/refund-transaction", route(async (req, res) => {
    const local = (await pool.query("SELECT * FROM access_rounds WHERE round_pda = $1 AND state IN ('settled', 'access_granted')", [req.params.roundPda])).rows[0];
    if (!local) throw new Error("access_round_not_settled");
    const transaction = await buildRefundLosingBidTransaction({ rpcUrl: solana.rpcUrl, programId: local.program_id, roundPda: local.round_pda, bidder: req.wallet.address });
    res.json({ ...transaction, transaction_base64: transaction.transactionBase64 });
  }));
  wallet.get("/wallet/access-entitlements", route(async (req, res) => {
    const rounds = await pool.query("SELECT round.package_id, round.round_pda, round.program_id, round.state FROM access_rounds AS round WHERE round.confirmation_status = 'finalized'");
    const entitlements = [];
    for (const round of rounds.rows) { const entitlement = await readAccessEntitlement({ rpcUrl: solana.rpcUrl, programId: round.program_id, roundPda: round.round_pda, wallet: req.wallet.address }); if (entitlement) entitlements.push({ package_id: round.package_id, round_state: round.state, ...entitlement, tier: tierName(entitlement.tier) }); }
    res.json({ entitlements });
  }));
  wallet.get("/wallet/auction-positions", route(async (req, res) => {
    const positions = await pool.query("SELECT bid.amount_lamports, bid.tier, bid.status, bid.placed_at, round.round_pda, round.state AS round_state, round.max_winners, round.winners_count, package.id AS package_id, package.public_metadata FROM auction_bids AS bid JOIN access_rounds AS round ON round.id = bid.access_round_id JOIN dataset_packages AS package ON package.id = round.package_id WHERE bid.wallet_id = $1 ORDER BY bid.placed_at DESC", [req.wallet.wallet_id]);
    res.json({ positions: positions.rows });
  }));
  async function protectedContext(req) {
    const context = await packageContext(pool, req.params.packageId); if (!context || !context.dataset_pda || !context.round_pda) throw new Error("package_not_found");
    const entitlement = await readAccessEntitlement({ rpcUrl: solana.rpcUrl, programId: context.program_id, roundPda: context.round_pda, wallet: req.wallet.address });
    if (!entitlement || entitlement.datasetCommitment !== context.dataset_pda) throw new Error("entitlement_access_denied");
    const selected = await chooseProtectedVersion(pool, context, entitlement);
    const objectKey = selected.redistribution_rights ? selected.normalized_object_key : selected.derivative_rights ? selected.derived_signal_object_key : null;
    if (!objectKey) throw new Error("licensed_artifact_unavailable");
    return { context: { ...selected, deliverable_object_key: objectKey }, grant: entitlement };
  }
  async function audited(req, action, resourceId, metadata = {}) { await repositories.audits.create({ actor_type: "wallet", actor_id: req.wallet.wallet_id, wallet_address: req.wallet.address, action, resource_type: "dataset_package", resource_id: resourceId, outcome: "allowed", metadata }); }
  wallet.get("/dataset/:packageId/metadata", route(async (req, res) => { const { context, grant } = await protectedContext(req); const bytes = await streamBytes(await artifactStore.getStream(context.private_metadata_object_key)); await audited(req, "dataset_metadata_read", context.id, { entitlement_pda: grant.entitlementPda }); res.type("application/json").send(bytes); }));
  wallet.get("/dataset/:packageId/report", route(async (req, res) => { const { context, grant } = await protectedContext(req); const bytes = await streamBytes(await artifactStore.getStream(context.report_object_key)); await audited(req, "dataset_report_read", context.id, { entitlement_pda: grant.entitlementPda }); res.type("application/json").send(bytes); }));
  wallet.get("/dataset/:packageId/:kind", route(async (req, res) => { if (!["data", "export"].includes(req.params.kind)) throw new Error("artifact_not_found"); const { context, grant } = await protectedContext(req); const stream = await artifactStore.getStream(context.deliverable_object_key); await audited(req, req.params.kind === "export" ? "dataset_export" : "dataset_data_read", context.id, { entitlement_pda: grant.entitlementPda, dataset_version: context.dataset_version, artifact_form: context.redistribution_rights ? "normalized" : "derived" }); res.type("application/x-ndjson"); if (req.params.kind === "export") res.setHeader("Content-Disposition", `attachment; filename="qarau-${context.id}-v${context.dataset_version}.jsonl"`); stream.pipe(res); }));
  router.use(wallet);
  return router;
}

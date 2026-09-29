import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { createRepositories } from "../db/repositories/index.mjs";
import { fromDoc } from "../db/mongo.mjs";
import { HASH_DOMAINS, canonicalJsonBytes, hashBytes, validateAccessPolicy } from "../domain/canonical-artifacts.mjs";
import { effectiveAccessRoundState, hasTemporalAccessRoundState } from "../domain/access-round-state.mjs";
import { buildDeliveredView } from "../domain/delivered-view.mjs";
import { jobIdempotencyKey } from "../jobs/payloads.mjs";
import { MongoJobQueue } from "../jobs/queue.mjs";
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
  if (/invalid|unsupported|required|unsafe|unavailable|not_sealed|not_complete|not_active|not_approved|not_settled|not_settleable|still_open|not_open|below_minimum|tier_not_enabled|screening_failed|already_placed|conflict/.test(message)) return 400;
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
// Mongo equivalent of a column list: keeps exactly these keys so the
// response shape matches the previous row shape (missing/NULL -> null).
function select(row, keys) {
  const out = {};
  for (const key of keys) out[key] = row?.[key] ?? null;
  return out;
}
async function findOneDoc(db, table, filter) {
  return fromDoc(await db.collection(table).findOne(filter));
}
async function findDocs(db, table, filter, { sort, limit, skip, pick } = {}) {
  let cursor = db.collection(table).find(filter ?? {});
  if (sort) cursor = cursor.sort(sort);
  if (skip) cursor = cursor.skip(skip);
  if (limit != null) cursor = cursor.limit(limit);
  const docs = (await cursor.toArray()).map(fromDoc);
  return pick ? docs.map((doc) => select(doc, pick)) : docs;
}
// Binary hashes come back as BSON Binary from Mongo instead of Buffer;
// normalize both to the same hex string the bytea path produced.
function hashHex(value) {
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (value && value._bsontype === "Binary" && typeof value.toString === "function") return value.toString("hex");
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  return Buffer.from(value).toString("hex");
}
// Ascending comparison with NULLS LAST, matching PostgreSQL ORDER BY ... ASC.
function cmpAsc(a, b) {
  const an = a == null; const bn = b == null;
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}
// ORDER BY CASE WHEN id = best THEN 0 ELSE 1 END, id LIMIT 1
function bestFirst(candidates, bestId) {
  return [...candidates].sort((a, b) => (Number(b.id === bestId) - Number(a.id === bestId)) || cmpAsc(a.id, b.id));
}
function sanitizePublicText(value, max) {
  let text = String(value ?? "").slice(0, max);
  text = text.replace(/https?:\/\/[^\s]+/gi, "").replace(/www\.[^\s]+/gi, "").trim().replace(/\s+/g, " ");
  return text;
}
function sanitizeValidationSummary(value) {
  if (!value || typeof value !== "object") return {};
  const band = value.evidence_band ?? value.evidenceBand;
  return band ? { evidence_band: String(band).slice(0, 32) } : {};
}
function publicPackage(row) {
  const rawMeta = row.public_metadata ?? {};
  const metadata = {};
  for (const [key, value] of Object.entries(rawMeta)) {
    if (!NON_SENSITIVE_PUBLIC_FIELDS.has(key)) continue;
    if (key === "title") metadata.title = sanitizePublicText(value, 160) || "Validated QARAU dataset";
    else if (key === "description") metadata.description = sanitizePublicText(value, 500) || "Quantitatively validated external dataset.";
    else if (key === "validation_summary") metadata.validation_summary = sanitizeValidationSummary(value);
    else metadata[key] = value;
  }
  return {
    package_id: row.id,
    ...metadata,
    commitment_address: row.dataset_pda,
    access_round_address: row.round_pda,
    access_round_id: row.access_round_id,
    access_round: row.round_pda ? {
      state: effectiveAccessRoundState(row),
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

// Storage predicates are the primary boundary; this second check prevents a future
// query refactor from accidentally publishing local fixtures as Devnet state.
export function isVerifiedDevnetOpportunity(row) {
  return row?.status === "committed"
    && row.commitment_network === "devnet"
    && row.commitment_confirmation_status === "finalized"
    && row.commitment_chain_state_source === "rpc_verified"
    && row.round_network === "devnet"
    && row.round_confirmation_status === "finalized"
    && row.round_chain_state_source === "rpc_verified"
    && Boolean(row.dataset_pda)
    && Boolean(row.round_pda);
}

async function marketSnapshot({ repositories, artifactStore, symbol }) {
  const data = await loadMarketTarget(symbol);
  const config = { "BTC-USD": { provider: "COINBASE", assetClass: "crypto", calendar: "24x7", currency: "USD" }, "ETH-USD": { provider: "COINBASE", assetClass: "crypto", calendar: "24x7", currency: "USD" } }[symbol] ?? { provider: "ECB", assetClass: "fx", calendar: "weekday", currency: "USD" };
  let target = await repositories.marketTargets.findByProviderSymbol(config.provider, data.symbol);
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

async function packageContext(db, packageId) {
  const pkg = await findOneDoc(db, "dataset_packages", { _id: packageId });
  if (!pkg) return null;
  const version = await findOneDoc(db, "dataset_versions", { _id: pkg.dataset_version_id });
  if (!version) return null;
  const dataset = await findOneDoc(db, "datasets", { _id: version.dataset_id });
  if (!dataset) return null;
  const source = await findOneDoc(db, "sources", { _id: dataset.source_id });
  if (!source) return null;
  const analysis = await findOneDoc(db, "analysis_runs", { _id: pkg.analysis_run_id });
  if (!analysis) return null;
  const commitment = await findOneDoc(db, "blockchain_commitments", { package_id: pkg.id, network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified" });
  const round = await findOneDoc(db, "access_rounds", { package_id: pkg.id, network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified" });
  const candidates = await findDocs(db, "signal_candidates", { analysis_run_id: analysis.id });
  const derived = bestFirst(candidates, analysis.best_signal_candidate_id)[0];
  return {
    ...pkg,
    dataset_id: version.dataset_id,
    dataset_version: version.version,
    normalized_object_key: version.normalized_object_key,
    report_object_key: analysis.report_object_key,
    alpha_score: analysis.alpha_score,
    dataset_pda: commitment?.dataset_pda ?? null,
    program_id: commitment?.program_id ?? null,
    commitment_network: commitment?.network ?? null,
    commitment_confirmation_status: commitment?.confirmation_status ?? null,
    commitment_chain_state_source: commitment?.chain_state_source ?? null,
    access_round_id: round?.id ?? null,
    round_pda: round?.round_pda ?? null,
    round_state: round?.state ?? null,
    opens_at: round?.opens_at ?? null,
    closes_at: round?.closes_at ?? null,
    minimum_bid_lamports: round?.minimum_bid_lamports ?? null,
    max_winners: round?.max_winners ?? null,
    bid_count: round?.bid_count ?? null,
    winners_count: round?.winners_count ?? null,
    clearing_price_lamports: round?.clearing_price_lamports ?? null,
    settlement_rule: round?.settlement_rule ?? null,
    decoded_state: round?.decoded_state ?? null,
    round_network: round?.network ?? null,
    round_confirmation_status: round?.confirmation_status ?? null,
    round_chain_state_source: round?.chain_state_source ?? null,
    redistribution_rights: source?.redistribution_rights ?? null,
    derivative_rights: source?.derivative_rights ?? null,
    derived_signal_object_key: derived?.artifact_object_key ?? null,
  };
}

export async function chooseProtectedVersion(db, context, grant) {
  const policy = context.access_policy;
  if (grant.tier === 1) return context;
  if (grant.tier !== 2) throw new Error("grant_tier_invalid");
  if (Math.floor(Date.now() / 1_000) < grant.grantedAt + Number(policy.delayed.release_seconds)) throw new Error("delayed_access_not_released");
  const requested = context.dataset_version - Number(policy.delayed.version_lag);
  const versions = await findDocs(db, "dataset_versions", { dataset_id: context.dataset_id, version: { $lte: requested }, status: "sealed" }, { sort: { version: -1 }, limit: 1 });
  if (!versions.length) throw new Error("delayed_version_unavailable");
  const version = versions[0];
  const runs = await findDocs(db, "analysis_runs", { dataset_version_id: version.id, status: "completed", blocking_leakage: false });
  const artifacts = runs
    .filter((run) => run.report_object_key != null)
    .sort((a, b) => {
      const ac = a.completed_at ? new Date(a.completed_at).getTime() : null;
      const bc = b.completed_at ? new Date(b.completed_at).getTime() : null;
      if (ac == null && bc == null) return 0;
      if (ac == null) return 1;
      if (bc == null) return -1;
      if (ac !== bc) return bc - ac;
      const acr = new Date(a.created_at).getTime(); const bcr = new Date(b.created_at).getTime();
      if (acr !== bcr) return bcr - acr;
      return cmpAsc(b.id, a.id);
    })[0];
  if (!artifacts) throw new Error("delayed_artifacts_unavailable");
  const signals = await findDocs(db, "signal_candidates", { analysis_run_id: artifacts.id });
  const derived = bestFirst(signals, artifacts.best_signal_candidate_id)[0];
  const derivedSignalObjectKey = derived?.artifact_object_key ?? null;
  if (!artifacts?.report_object_key || !derivedSignalObjectKey) throw new Error("delayed_artifacts_unavailable");
  return {
    ...context,
    normalized_object_key: version.normalized_object_key,
    normalized_dataset_hash: version.normalized_hash,
    dataset_version: version.version,
    analysis_run_id: artifacts.id,
    report_object_key: artifacts.report_object_key,
    analysis_result_hash: artifacts.result_hash,
    derived_signal_object_key: derivedSignalObjectKey,
  };
}

export function createV1Router({ db, artifactStore, solana, ownerMiddleware, csrfMiddleware, publicOrigin }) {
  if (!db || !artifactStore || !solana?.rpcUrl || !solana?.programId) throw new Error("v1_router_configuration_required");
  const repositories = createRepositories(db);
  const queue = new MongoJobQueue(db);
  const origin = new URL(publicOrigin ?? "http://localhost:5173");
  const siws = createSiwsService({ db, domain: origin.host, uri: origin.toString().replace(/\/$/, "") });
  const router = express.Router();
  const owner = express.Router();
  owner.use(ownerMiddleware, csrfMiddleware);

  owner.get("/sources", route(async (_req, res) => {
    const sources = await repositories.sources.findWhere({}, { sort: { discovered_at: -1 }, limit: 500 });
    const screenings = sources.length
      ? await repositories.sourceScreenings.findWhere({ source_id: { $in: sources.map((source) => source.id) } })
      : [];
    const screeningBySource = new Map(screenings.map((screening) => [screening.source_id, screening]));
    const rows = sources.map((source) => {
      const screening = screeningBySource.get(source.id);
      return {
        ...select(source, ["id", "domain", "title", "description", "source_type", "expected_fields", "temporal_coverage", "expected_update_interval", "status", "reliability", "license_status", "redistribution_rights", "derivative_rights", "last_successful_ingestion_at", "next_scrape_at", "discovered_at"]),
        screening_score: screening?.score ?? null,
        screening_passed: screening?.passed ?? null,
        rejection_reasons: screening?.rejection_reasons ?? null,
      };
    });
    res.json({ sources: rows });
  }));
  owner.get("/sources/:id", route(async (req, res) => {
    if (!validUuid(req.params.id)) throw new Error("invalid_source_id");
    const source = await repositories.sources.findById(req.params.id); if (!source) throw new Error("source_not_found");
    const dataset = await findOneDoc(db, "datasets", { source_id: source.id });
    const runs = await findDocs(db, "ingestion_runs", { source_id: source.id }, { sort: { created_at: -1 }, limit: 100, pick: ["id", "status", "retrieved_at", "record_count", "change_type", "parser_name", "parser_version", "error_code", "created_at"] });
    const versions = dataset
      ? await findDocs(db, "dataset_versions", { dataset_id: dataset.id }, { sort: { version: -1 }, pick: ["id", "dataset_id", "version", "status", "quality_metrics", "coverage_start", "coverage_end", "frequency", "record_count", "missing_rate", "duplicate_rate", "outlier_rate", "continuity", "sealed_at"] })
      : [];
    const analyses = versions.length
      ? await findDocs(db, "analysis_runs", { dataset_version_id: { $in: versions.map((version) => version.id) } }, { sort: { created_at: -1 }, pick: ["id", "status", "alpha_score", "blocking_leakage", "created_at", "completed_at"] })
      : [];
    const screeningRow = await findOneDoc(db, "source_screenings", { source_id: source.id });
    const screening = screeningRow ? select(screeningRow, ["gates", "score", "passed", "rejection_reasons", "screened_at"]) : null;
    res.json({ source: { ...source, canonical_url_ciphertext: undefined, canonical_url_hash: undefined, screening }, ingestion_runs: runs, versions, analysis_runs: analyses });
  }));
  owner.post("/discovery/jobs", route(async (req, res) => {
    const queryGroup = String(req.body?.query_group ?? "general").toLowerCase();
    if (!/^[a-z]{3,40}$/.test(queryGroup)) throw new Error("invalid_discovery_query_group");
    const payload = { queryGroup, requestedBy: null, requestId: randomUUID() }; const job = await queue.enqueue({ type: "discovery.run", payload, idempotencyKey: jobIdempotencyKey("discovery.run", 1, payload), resourceType: "discovery" });
    res.status(202).json({ job: job.job, created: job.created });
  }));
  owner.post("/sources/:id/approve", route(async (req, res) => {
    if (!validUuid(req.params.id)) throw new Error("invalid_source_id");
    const screening = await findOneDoc(db, "source_screenings", { source_id: req.params.id });
    if (!screening?.passed) throw new Error("source_screening_failed");
    const redistribution = req.body?.redistribution_rights === true;
    const derivative = req.body?.derivative_rights === true;
    if (req.body?.license_approved !== true || (!redistribution && !derivative)) throw new Error("invalid_license_decision");
    const existing = await repositories.sources.findById(req.params.id);
    if (!existing) throw new Error("source_not_found");
    const changed = await repositories.sources.updateById(req.params.id, { status: "active", next_scrape_at: existing.next_scrape_at ?? new Date(Date.now() + 3.6e6), license_status: "approved", redistribution_rights: redistribution, derivative_rights: derivative, license_reviewed_by: OWNER_ACTOR_ID, license_reviewed_at: new Date(), updated_at: new Date() });
    if (!changed) throw new Error("source_not_found"); res.json({ source: select(changed, ["id", "status", "next_scrape_at", "license_status", "redistribution_rights", "derivative_rights"]) });
  }));
  owner.post("/sources/:id/scrapes", route(async (req, res) => {
    if (!validUuid(req.params.id)) throw new Error("invalid_source_id");
    const source = await repositories.sources.findById(req.params.id); if (!source || source.status !== "active") throw new Error("source_not_active");
    await repositories.sources.updateById(source.id, { next_scrape_at: new Date(Date.now() + 24 * 3.6e6), updated_at: new Date() });
    const payload = { sourceId: source.id, reason: "manual", scheduledFor: nowIso() }; const job = await queue.enqueue({ type: "scrape.source", payload, idempotencyKey: jobIdempotencyKey("scrape.source", 1, payload), resourceType: "source", resourceId: source.id });
    res.status(202).json({ job: job.job, created: job.created });
  }));
  owner.post("/dataset-versions/:id/analysis-runs", route(async (req, res) => {
    if (!validUuid(req.params.id)) throw new Error("invalid_dataset_version_id");
    const version = await repositories.datasetVersions.findById(req.params.id); if (!version || version.status !== "sealed") throw new Error("dataset_version_not_sealed");
    const symbol = String(req.body?.target_symbol ?? "BTC-USD").toUpperCase();
    if (!["BTC-USD", "ETH-USD", "EURUSD", "EURGBP", "EURJPY", "EURCHF"].includes(symbol)) throw new Error("unsupported_market_target");
    const { target, snapshot } = await marketSnapshot({ db, repositories, artifactStore, symbol });
    const existing = await findDocs(db, "dataset_target_mappings", { dataset_id: version.dataset_id, target_id: target.id }, { sort: { mapping_version: -1 }, limit: 1 });
    const mapping = existing[0] ?? await repositories.targetMappings.create({ dataset_id: version.dataset_id, target_id: target.id, physical_variable: (Array.isArray(version.schema_profile?.value_fields) ? version.schema_profile.value_fields : ["numeric_measurement"]).join(","), economic_mechanism: "Proposed physical-data relationship; quantitative validation required.", affected_asset: symbol, ai_rationale: "Local deterministic mapper proposed this target from public source metadata; it does not score alpha.", confidence: .25, status: "proposed", mapping_version: 1 });
    const run = await repositories.analysisRuns.create({ dataset_version_id: version.id, market_snapshot_id: snapshot.id, mapping_id: mapping.id, status: "queued", pipeline_version: "quantitative-v1" });
    const payload = { analysisRunId: run.id }; const job = await queue.enqueue({ type: "analysis.run", payload, idempotencyKey: jobIdempotencyKey("analysis.run", 1, payload), resourceType: "analysis_run", resourceId: run.id });
    res.status(202).json({ analysis_run: run, job: job.job, target, mapping });
  }));
  owner.get("/analysis-runs/:id", route(async (req, res) => {
    if (!validUuid(req.params.id)) throw new Error("invalid_analysis_run_id");
    const run = await repositories.analysisRuns.findById(req.params.id); if (!run) throw new Error("analysis_run_not_found");
    const { limit, offset } = pageQuery(req.query);
    const [signals, signalCount, checkGroups, components, latestPackages] = await Promise.all([
      findDocs(db, "signal_candidates", { analysis_run_id: run.id }, { sort: { source_column: 1, transformation: 1, lag: 1, horizon: 1, id: 1 }, limit, skip: offset }),
      repositories.signalCandidates.countWhere({ analysis_run_id: run.id }),
      db.collection("leakage_check_results").aggregate([
        { $match: { analysis_run_id: run.id } },
        { $group: { _id: { check_type: "$check_type", status: "$status" }, count: { $sum: 1 }, score_penalty: { $sum: { $ifNull: ["$score_penalty", 0] } }, explanation: { $min: "$explanation" } } },
        { $sort: { "_id.check_type": 1, "_id.status": 1 } },
      ]).toArray(),
      findDocs(db, "alpha_score_components", { analysis_run_id: run.id }, { sort: { component: 1 } }),
      findDocs(db, "dataset_packages", { analysis_run_id: run.id }, { sort: { created_at: -1 }, limit: 1, pick: ["id", "status", "public_metadata", "max_seats", "sealed_at", "created_at"] }),
    ]);
    const checks = checkGroups.map((group) => ({ check_type: group._id.check_type, status: group._id.status, count: group.count, score_penalty: group.score_penalty, explanation: group.explanation ?? null }));
    const signalIds = signals.map(({ id }) => id);
    const validations = signalIds.length
      ? await findDocs(db, "validation_results", { analysis_run_id: run.id, signal_candidate_id: { $in: signalIds }, split: "test" }, { sort: { signal_candidate_id: 1, id: 1 } })
      : [];
    const total = Number(signalCount ?? 0);
    res.json({
      analysis_run: run,
      signal_candidates: signals,
      validations,
      leakage_checks: checks,
      alpha_score_components: components,
      package: latestPackages[0] ?? null,
      pagination: { limit, offset, total, has_previous: offset > 0, has_next: offset + signals.length < total },
    });
  }));
  owner.post("/analysis-runs/:id/packages", route(async (req, res) => {
    if (!validUuid(req.params.id)) throw new Error("invalid_analysis_run_id");
    const analysis = await repositories.analysisRuns.findById(req.params.id); if (!analysis || analysis.status !== "completed" || analysis.blocking_leakage) throw new Error("analysis_run_not_complete");
    const existing = await findDocs(db, "dataset_packages", { analysis_run_id: analysis.id }, { sort: { created_at: -1 }, limit: 1 });
    if (existing.length) return res.json({ package: existing[0], existing: true });
    const version = await repositories.datasetVersions.findById(analysis.dataset_version_id);
    if (!version) throw new Error("package_inputs_not_sealed");
    const snapshot = await findOneDoc(db, "source_snapshots", { _id: version.source_snapshot_id });
    if (!snapshot || !analysis.manifest_hash || !analysis.result_hash) throw new Error("package_inputs_not_sealed");
    const policy = validateAccessPolicy(req.body?.access_policy ?? { policy_version: 1, grant_scope: "PURCHASED_DATASET_LINE", allowed_tier_mask: 3, early: { available_immediately: true }, delayed: { version_lag: 1, release_seconds: "604800" }, expiry: { grant_duration_seconds: "2592000" } });
    const maxSeats = Number(req.body?.max_seats ?? 10); if (!Number.isInteger(maxSeats) || maxSeats < 1 || maxSeats > 10_000) throw new Error("invalid_max_seats");
    const dataset = await findOneDoc(db, "datasets", { _id: version.dataset_id });
    const rights = dataset ? await findOneDoc(db, "sources", { _id: dataset.source_id }) : null;
    if (rights?.license_status !== "approved" || (!rights.redistribution_rights && !rights.derivative_rights)) throw new Error("package_license_not_approved");
    const evidenceBand = Number(analysis.alpha_score) >= 75 ? "strong" : Number(analysis.alpha_score) >= 50 ? "moderate" : Number(analysis.alpha_score) >= 25 ? "weak" : "rejected";
    const requestedTitle = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : "";
    const requestedDescription = typeof req.body?.description === "string" && req.body.description.trim() ? req.body.description.trim() : "";
    const publicMetadata = { title: sanitizePublicText(requestedTitle || "Validated QARAU dataset", 160) || "Validated QARAU dataset", description: sanitizePublicText(requestedDescription || "Quantitatively validated external dataset.", 500) || "Quantitatively validated external dataset.", coverage: { start: version.coverage_start, end: version.coverage_end }, update_frequency: version.frequency, evidence_band: evidenceBand, access_form: rights.redistribution_rights ? "normalized_and_derived" : "derived_only", validation_summary: { evidence_band: evidenceBand } };
    const packageId = randomUUID(); const policyBytes = canonicalJsonBytes(policy); const policyHash = hashBytes(HASH_DOMAINS.accessPolicy, policyBytes);
    const privateBytes = Buffer.from(JSON.stringify({ package_id: packageId, dataset_version_id: version.id, analysis_run_id: analysis.id, created_at: nowIso() }), "utf8");
    const privateKey = `packages/${packageId}/private-metadata.json`; const policyKey = `packages/${packageId}/access-policy.json`;
    await artifactStore.putOnce({ key: privateKey, bytes: privateBytes, artifactHash: hash(privateBytes).toString("hex"), contentType: "application/json" });
    await artifactStore.putOnce({ key: policyKey, bytes: policyBytes, artifactHash: policyHash, contentType: "application/json" });
    const created = await repositories.packages.create({ id: packageId, dataset_version_id: version.id, analysis_run_id: analysis.id, status: "sealed", public_metadata: publicMetadata, private_metadata_object_key: privateKey, access_policy: policy, access_policy_object_key: policyKey, access_policy_hash: Buffer.from(policyHash, "hex"), max_seats: maxSeats, raw_snapshot_hash: snapshot.raw_hash, normalized_dataset_hash: version.normalized_hash, analysis_manifest_hash: analysis.manifest_hash, analysis_result_hash: analysis.result_hash, sealed_at: new Date(), created_by: OWNER_ACTOR_ID });
    res.status(201).json({ package: created, existing: false });
  }));
  owner.post("/packages/:id/publish", route(async (req, res) => {
    if (!validUuid(req.params.id)) throw new Error("invalid_package_id");
    const packageRow = await repositories.packages.findById(req.params.id);
    if (!packageRow || !["sealed", "publication_failed", "commit_pending", "committed"].includes(packageRow.status)) throw new Error("sealed_package_not_found");
    const existingRound = await findOneDoc(db, "access_rounds", { package_id: packageRow.id, network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified" });
    if (existingRound) throw new Error("access_round_conflict");
    const active = await findDocs(db, "jobs", { type: "chain.publish", resource_type: "dataset_package", resource_id: packageRow.id, status: { $in: ["queued", "running", "retry_wait"] } }, { sort: { created_at: -1 }, limit: 1 });
    if (active.length) return res.status(202).json({ job: active[0], created: false });
    const previous = await findDocs(db, "jobs", { type: "chain.publish", resource_type: "dataset_package", resource_id: packageRow.id }, { sort: { created_at: -1 }, limit: 1 });
    const previousPayload = previous[0]?.payload;
    const opensAt = req.body?.opens_at ? new Date(req.body.opens_at) : new Date(previousPayload?.opensAt ?? Date.now() - 60_000);
    const closesAt = req.body?.closes_at ? new Date(req.body.closes_at) : new Date(previousPayload?.closesAt ?? Date.now() + 24 * 60 * 60_000);
    if (!Number.isFinite(opensAt.getTime()) || !Number.isFinite(closesAt.getTime()) || closesAt <= opensAt || closesAt.getTime() <= Date.now()) throw new Error("invalid_auction_window");
    const minimumBidLamports = Number(req.body?.minimum_bid_lamports ?? previousPayload?.minimumBidLamports ?? 500_000);
    const maxWinners = Number(req.body?.max_winners ?? previousPayload?.maxWinners ?? Math.min(packageRow.max_seats, 10));
    if (!Number.isSafeInteger(minimumBidLamports) || minimumBidLamports < 1 || !Number.isInteger(maxWinners) || maxWinners < 1 || maxWinners > Math.min(packageRow.max_seats, 10)) throw new Error("invalid_auction_terms");
    const payload = { packageId: packageRow.id, opensAt: opensAt.toISOString(), closesAt: closesAt.toISOString(), minimumBidLamports, maxWinners };
    const job = await queue.enqueue({ type: "chain.publish", payloadVersion: 2, payload, idempotencyKey: `${jobIdempotencyKey("chain.publish", 2, payload)}:${randomUUID()}`, resourceType: "dataset_package", resourceId: packageRow.id });
    await db.collection("dataset_packages").updateOne({ _id: packageRow.id, status: { $in: ["sealed", "publication_failed"] } }, { $set: { status: "commit_pending" } });
    res.status(202).json({ job: job.job, created: job.created });
  }));
  owner.post("/access-rounds/:id/settle", route(async (req, res) => {
    if (!validUuid(req.params.id)) throw new Error("invalid_access_round_id");
    const round = await findOneDoc(db, "access_rounds", { _id: req.params.id, network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified" });
    if (!round) throw new Error("access_round_not_settleable");
    const effectiveState = effectiveAccessRoundState(round);
    if (hasTemporalAccessRoundState(round) && effectiveState !== round.state) {
      await db.collection("access_rounds").updateOne({ _id: round.id, state: { $in: ["upcoming", "live", "ended"] } }, { $set: { state: effectiveState, last_reconciled_at: new Date() } });
    }
    if (effectiveState === "live") throw new Error("auction_still_open");
    if (effectiveState !== "ended") throw new Error("access_round_not_settleable");
    const payload = { accessRoundId: round.id };
    const job = await queue.enqueue({ type: "chain.settle", payload, idempotencyKey: jobIdempotencyKey("chain.settle", 1, payload), resourceType: "access_round", resourceId: round.id });
    res.status(202).json({ job: job.job, created: job.created });
  }));
  owner.post("/registry/pause", route(async (req, res) => {
    // The API holds no signer credentials by design, so the kill-switch is
    // queued for worker-chain rather than reached directly.
    const paused = req.body?.paused;
    if (typeof paused !== "boolean") throw new Error("invalid_paused_flag");
    const payload = { paused, requestedBy: OWNER_ACTOR_ID };
    const job = await queue.enqueue({ type: "chain.pause", payload, idempotencyKey: jobIdempotencyKey("chain.pause", 1, payload) + ":" + randomUUID(), resourceType: "registry" });
    res.status(202).json({ job: job.job, created: job.created });
  }));
  owner.get("/cockpit/funnel", route(async (_req, res) => {
    const sources = await repositories.sources.findWhere({}, { sort: { discovered_at: -1 }, limit: 40 });
    const screenings = sources.length
      ? await repositories.sourceScreenings.findWhere({ source_id: { $in: sources.map((source) => source.id) } })
      : [];
    const screeningBySource = new Map(screenings.map((screening) => [screening.source_id, screening]));
    const rows = [];
    for (const source of sources) {
      const screening = screeningBySource.get(source.id) ?? null;
      const dataset = await findOneDoc(db, "datasets", { source_id: source.id });
      const version = dataset ? (await findDocs(db, "dataset_versions", { dataset_id: dataset.id }, { sort: { version: -1 }, limit: 1 }))[0] ?? null : null;
      const analysis = version ? (await findDocs(db, "analysis_runs", { dataset_version_id: version.id }, { sort: { created_at: -1 }, limit: 1 }))[0] ?? null : null;
      const packageRow = analysis ? (await findDocs(db, "dataset_packages", { analysis_run_id: analysis.id }, { sort: { created_at: -1 }, limit: 1 }))[0] ?? null : null;
      const round = packageRow ? await findOneDoc(db, "access_rounds", { package_id: packageRow.id }) : null;
      rows.push({
        id: source.id,
        name: source.title ?? source.domain,
        source_type: source.source_type,
        category: source.reliability?.category ?? "external",
        region: source.reliability?.region ?? "global",
        score: screening?.score ?? null,
        passed: screening?.passed ?? null,
        version_id: version?.id ?? null,
        frequency: version?.frequency ?? null,
        continuity: version?.continuity ?? null,
        analysis_id: analysis?.id ?? null,
        alpha_score: analysis?.alpha_score ?? null,
        analysis_status: analysis?.status ?? null,
        package_id: packageRow?.id ?? null,
        round_id: round?.id ?? null,
      });
    }
    const labels = ["DISCOVERED", "SCREENED", "INGESTED", "VALIDATED", "PUBLISHED"];
    const lanes = rows.map((row, rank) => {
      const reachedStage = row.round_id ? 4 : row.package_id || row.analysis_status === "completed" ? 3 : row.version_id ? 2 : row.passed ? 1 : 0;
      return { id: row.id, rank, survived: Boolean(row.round_id), diedAt: row.round_id ? null : reachedStage, diedAtLabel: row.round_id ? null : labels[reachedStage], reachedStage, signalId: row.analysis_id, ic: Number(row.alpha_score ?? 0) / 100, lag: 0, stability: Number(row.continuity ?? 0), reason: row.passed === false ? "Screening gates not met" : null, seed: rank, dataset: { id: String(row.id).slice(0, 8).toUpperCase(), name: row.name, category: row.category, sourceType: row.source_type, region: row.region, frequency: row.frequency ?? "—", historyYears: 0, quality: Number(row.score ?? 0) / 10, site: { city: "—", country: row.region, lat: 0, lon: 0 }, coverage: "—" } };
    });
    const stageCounts = labels.map((_, stage) => lanes.filter((lane) => lane.reachedStage >= stage).length);
    res.json({ runId: "production-funnel", target: "QARAU evidence pipeline", stageLabels: labels, stageCounts, sampled: lanes.length, tested: Number(stageCounts[0] ?? 0), lanes });
  }));
  owner.get("/jobs/:id", route(async (req, res) => { const job = await repositories.jobs.findById(req.params.id); if (!job) throw new Error("job_not_found"); res.json({ job }); }));

  // Contract paths are mounted at /api/v1; /owner is retained as a readable
  // console alias. Public routes never enter the owner middleware.
  const isOwnerPath = (path) => /^\/(?:sources(?:\/|$)|discovery\/jobs$|dataset-versions\/[^/]+\/analysis-runs$|analysis-runs(?:\/|$)|packages\/[^/]+\/publish$|access-rounds\/[^/]+\/settle$|cockpit\/funnel$|registry\/pause$|jobs\/[^/]+$)/.test(path);
  router.use((req, res, next) => isOwnerPath(req.path) ? owner.handle(req, res, next) : next());
  router.use("/owner", owner);
  router.get("/opportunities", route(async (_req, res) => {
    const packages = await findDocs(db, "dataset_packages", { status: "committed" }, { sort: { created_at: -1 } });
    const rows = [];
    for (const pkg of packages) {
      const commitment = await findOneDoc(db, "blockchain_commitments", { package_id: pkg.id, network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified" });
      if (!commitment) continue;
      const round = await findOneDoc(db, "access_rounds", { package_id: pkg.id, network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified" });
      if (!round) continue;
      rows.push({
        ...pkg,
        dataset_pda: commitment.dataset_pda,
        commitment_network: commitment.network,
        commitment_confirmation_status: commitment.confirmation_status,
        commitment_chain_state_source: commitment.chain_state_source,
        access_round_id: round.id,
        round_pda: round.round_pda,
        round_state: round.state,
        opens_at: round.opens_at,
        closes_at: round.closes_at,
        minimum_bid_lamports: round.minimum_bid_lamports,
        max_winners: round.max_winners,
        bid_count: round.bid_count,
        winners_count: round.winners_count,
        clearing_price_lamports: round.clearing_price_lamports,
        settlement_rule: round.settlement_rule,
        round_network: round.network,
        round_confirmation_status: round.confirmation_status,
        round_chain_state_source: round.chain_state_source,
      });
    }
    res.json({ packages: rows.filter(isVerifiedDevnetOpportunity).map(publicPackage) });
  }));
  router.get("/opportunities/:id", route(async (req, res) => { const context = await packageContext(db, req.params.id); if (!isVerifiedDevnetOpportunity(context)) throw new Error("package_not_found"); res.json({ package: publicPackage(context) }); }));
  router.get("/packages/:id/proof", route(async (req, res) => {
    const context = await packageContext(db, req.params.id); if (!context || !context.dataset_pda || !context.program_id) throw new Error("package_not_found");
    const chain = await readDatasetCommitment({ rpcUrl: solana.rpcUrl, programId: context.program_id, datasetPda: context.dataset_pda });
    const local = { raw_snapshot_hash: hashHex(context.raw_snapshot_hash), normalized_dataset_hash: hashHex(context.normalized_dataset_hash), analysis_manifest_hash: hashHex(context.analysis_manifest_hash), analysis_result_hash: hashHex(context.analysis_result_hash), access_policy_hash: hashHex(context.access_policy_hash) };
    const onchain = chain && { raw_snapshot_hash: chain.rawSnapshotHash, normalized_dataset_hash: chain.normalizedDatasetHash, analysis_manifest_hash: chain.analysisManifestHash, analysis_result_hash: chain.analysisResultHash, access_policy_hash: chain.accessPolicyHash };
    const matches = Boolean(onchain) && Object.entries(local).every(([key, value]) => onchain[key] === value);
    res.json({ status: !chain ? "UNAVAILABLE" : matches && chain.status === 1 ? "VERIFIED" : "MISMATCH", network: "devnet", program_id: context.program_id, dataset_pda: context.dataset_pda, onchain_hashes: onchain, local_hashes: local, matches, account_owner_valid: Boolean(chain), account_status_valid: chain?.status === 1, rpc_slot: chain?.slot ?? null, verified_at: nowIso() });
  }));
  router.post("/packages/:id/proof/verify", route(async (req, res) => { req.params.id = String(req.params.id); const context = await packageContext(db, req.params.id); if (!context || !context.dataset_pda || !context.program_id) throw new Error("package_not_found"); const chain = await readDatasetCommitment({ rpcUrl: solana.rpcUrl, programId: context.program_id, datasetPda: context.dataset_pda }); const local = { raw_snapshot_hash: hashHex(context.raw_snapshot_hash), normalized_dataset_hash: hashHex(context.normalized_dataset_hash), analysis_manifest_hash: hashHex(context.analysis_manifest_hash), analysis_result_hash: hashHex(context.analysis_result_hash), access_policy_hash: hashHex(context.access_policy_hash) }; const onchain = chain && { raw_snapshot_hash: chain.rawSnapshotHash, normalized_dataset_hash: chain.normalizedDatasetHash, analysis_manifest_hash: chain.analysisManifestHash, analysis_result_hash: chain.analysisResultHash, access_policy_hash: chain.accessPolicyHash }; const matches = Boolean(onchain) && Object.entries(local).every(([key, value]) => onchain[key] === value); res.json({ status: !chain ? "UNAVAILABLE" : matches && chain.status === 1 ? "VERIFIED" : "MISMATCH", network: "devnet", program_id: context.program_id, dataset_pda: context.dataset_pda, onchain_hashes: onchain, local_hashes: local, matches, account_owner_valid: Boolean(chain), account_status_valid: chain?.status === 1, rpc_slot: chain?.slot ?? null, verified_at: nowIso() }); }));
  router.post("/auth/siws/challenge", route(async (req, res) => {
    const walletAddress = String(req.body?.address ?? "");
    if (!walletAddress) throw new Error("wallet_address_required");
    const challenge = await siws.challenge({ address: walletAddress });
    res.json({ ...challenge, message: formatSiwsMessage({ domain: challenge.domain, address: walletAddress, uri: challenge.uri, chain_id: challenge.chain_id, nonce: challenge.nonce, issuedAt: challenge.issued_at, expirationTime: challenge.expiration_time }) });
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
    const local = await findOneDoc(db, "access_rounds", { round_pda: req.params.roundPda, network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified" });
    if (!local) throw new Error("access_round_not_found");
    const chain = await readAccessRound({ rpcUrl: solana.rpcUrl, programId: local.program_id, roundPda: local.round_pda });
    const now = Math.floor(Date.now() / 1_000);
    if (!chain || chain.status !== 1 || now < chain.opensAt || now > chain.closesAt) throw new Error("auction_not_active");
    if (!Number.isSafeInteger(amountLamports) || amountLamports < chain.minimumBidLamports) throw new Error("bid_below_minimum");
    if ((chain.enabledTierMask & tier) === 0) throw new Error("bid_tier_not_enabled");
    // A Bid PDA is permanent for (round, wallet). Surface that fact before a
    // wallet opens its signer, rather than producing an opaque Anchor error.
    if (await readBid({ rpcUrl: solana.rpcUrl, programId: local.program_id, roundPda: local.round_pda, bidder: req.wallet.address })) throw new Error("bid_already_placed");
    const transaction = await buildBidTransaction({ rpcUrl: solana.rpcUrl, programId: local.program_id, roundPda: local.round_pda, bidder: req.wallet.address, amountLamports, tier });
    res.json({ ...transaction, transaction_base64: transaction.transactionBase64, tier: tierName(tier) });
  }));
  wallet.post("/bids/confirm", route(async (req, res) => {
    const signature = String(req.body?.transaction_signature ?? "");
    const roundPda = String(req.body?.round_pda ?? "");
    const finalized = await readFinalizedSignature({ rpcUrl: solana.rpcUrl, signature }); if (!finalized) throw new Error("transaction_not_finalized");
    const local = await findOneDoc(db, "access_rounds", { round_pda: roundPda, network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified" });
    if (!local) throw new Error("access_round_not_found");
    const bid = await readBid({ rpcUrl: solana.rpcUrl, programId: local.program_id, roundPda, bidder: req.wallet.address });
    if (!bid || !await transactionTouchesAccounts({ rpcUrl: solana.rpcUrl, signature, required: [local.program_id, roundPda, bid.bidPda, req.wallet.address] })) throw new Error("bid_not_found");
    const tier = tierName(bid.tier); if (!tier) throw new Error("invalid_bid_tier");
    await db.collection("auction_bids").updateOne(
      { access_round_id: local.id, wallet_id: req.wallet.wallet_id },
      {
        $set: { amount_lamports: bid.amountLamports, tier, transaction_signature: signature, observed_slot: finalized.slot, placed_at: new Date(bid.placedAt * 1000), last_reconciled_at: new Date() },
        $setOnInsert: { _id: randomUUID(), access_round_id: local.id, bid_pda: bid.bidPda, wallet_id: req.wallet.wallet_id, status: "active" },
      },
      { upsert: true },
    );
    const observedBidCount = (await readAccessRound({ rpcUrl: solana.rpcUrl, programId: local.program_id, roundPda }))?.bidCount ?? 0;
    await db.collection("access_rounds").updateOne({ _id: local.id }, { $set: { bid_count: Math.max(local.bid_count ?? 0, observedBidCount), last_reconciled_at: new Date() } });
    res.json({ package_id: local.package_id, round_pda: roundPda, bid_pda: bid.bidPda, amount_lamports: bid.amountLamports, tier, status: "finalized" });
  }));
  wallet.post("/access-rounds/:roundPda/claim-transaction", route(async (req, res) => {
    const round = await findOneDoc(db, "access_rounds", { round_pda: req.params.roundPda, network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified", state: { $in: ["settled", "access_granted"] } });
    if (!round) throw new Error("access_round_not_settled");
    const commitment = await findOneDoc(db, "blockchain_commitments", { package_id: round.package_id, network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified" });
    const local = commitment ? { ...round, dataset_pda: commitment.dataset_pda } : null;
    if (!local?.decoded_state?.treasury) throw new Error("access_round_not_settled");
    const transaction = await buildClaimEntitlementTransaction({ rpcUrl: solana.rpcUrl, programId: local.program_id, commitmentPda: local.dataset_pda, roundPda: local.round_pda, treasury: local.decoded_state.treasury, bidder: req.wallet.address });
    res.json({ ...transaction, transaction_base64: transaction.transactionBase64 });
  }));
  wallet.post("/entitlements/confirm", route(async (req, res) => {
    const signature = String(req.body?.transaction_signature ?? ""); const roundPda = String(req.body?.round_pda ?? "");
    const finalized = await readFinalizedSignature({ rpcUrl: solana.rpcUrl, signature }); if (!finalized) throw new Error("transaction_not_finalized");
    const round = await findOneDoc(db, "access_rounds", { round_pda: roundPda, network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified" });
    if (!round) throw new Error("access_round_not_found");
    const commitment = await findOneDoc(db, "blockchain_commitments", { package_id: round.package_id, network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified" });
    if (!commitment) throw new Error("access_round_not_found");
    const local = { ...round, dataset_pda: commitment.dataset_pda };
    const entitlement = await readAccessEntitlement({ rpcUrl: solana.rpcUrl, programId: local.program_id, roundPda, wallet: req.wallet.address });
    if (!entitlement || entitlement.datasetCommitment !== local.dataset_pda || !await transactionTouchesAccounts({ rpcUrl: solana.rpcUrl, signature, required: [local.program_id, roundPda, entitlement.entitlementPda, req.wallet.address] })) throw new Error("entitlement_not_found");
    const tier = tierName(entitlement.tier); if (!tier) throw new Error("invalid_entitlement_tier");
    await db.collection("access_entitlement_cache").updateOne(
      { _id: entitlement.entitlementPda },
      {
        $set: { expires_at: new Date(entitlement.expiresAt * 1000), status: "active", transaction_signature: signature, slot: finalized.slot, last_reconciled_at: new Date() },
        $setOnInsert: { _id: entitlement.entitlementPda, access_round_id: local.id, package_id: local.package_id, wallet_id: req.wallet.wallet_id, tier, bid_amount_lamports: entitlement.bidAmountLamports, granted_at: new Date(entitlement.grantedAt * 1000) },
      },
      { upsert: true },
    );
    await db.collection("auction_bids").updateMany({ access_round_id: local.id, wallet_id: req.wallet.wallet_id }, { $set: { status: "claimed", last_reconciled_at: new Date() } });
    await db.collection("access_rounds").updateOne({ _id: local.id }, { $set: { state: "access_granted", last_reconciled_at: new Date() } });
    res.json({ package_id: local.package_id, round_pda: roundPda, entitlement_pda: entitlement.entitlementPda, tier, status: "finalized" });
  }));
  wallet.post("/bids/refund-confirm", route(async (req, res) => {
    const signature = String(req.body?.transaction_signature ?? "");
    const roundPda = String(req.body?.round_pda ?? "");
    const finalized = await readFinalizedSignature({ rpcUrl: solana.rpcUrl, signature }); if (!finalized) throw new Error("transaction_not_finalized");
    const local = await findOneDoc(db, "access_rounds", { round_pda: roundPda, network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified" });
    if (!local) throw new Error("access_round_not_found");
    if (!await transactionTouchesAccounts({ rpcUrl: solana.rpcUrl, signature, required: [local.program_id, roundPda, req.wallet.address] })) throw new Error("bid_not_found");
    // After a successful refund the Bid PDA is closed on-chain.
    const stillOpen = await readBid({ rpcUrl: solana.rpcUrl, programId: local.program_id, roundPda, bidder: req.wallet.address });
    if (stillOpen) throw new Error("bid_not_refunded");
    await db.collection("auction_bids").updateOne({ access_round_id: local.id, wallet_id: req.wallet.wallet_id }, { $set: { status: "refunded", transaction_signature: signature, last_reconciled_at: new Date() } });
    res.json({ package_id: local.package_id, round_pda: roundPda, status: "refunded" });
  }));
  wallet.post("/access-rounds/:roundPda/refund-transaction", route(async (req, res) => {
    const local = await findOneDoc(db, "access_rounds", { round_pda: req.params.roundPda, network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified", state: { $in: ["settled", "access_granted"] } });
    if (!local) throw new Error("access_round_not_settled");
    const transaction = await buildRefundLosingBidTransaction({ rpcUrl: solana.rpcUrl, programId: local.program_id, roundPda: local.round_pda, bidder: req.wallet.address });
    res.json({ ...transaction, transaction_base64: transaction.transactionBase64 });
  }));
  wallet.get("/wallet/access-entitlements", route(async (req, res) => {
    const rounds = await findDocs(db, "access_rounds", { network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified" }, { pick: ["package_id", "round_pda", "program_id", "state", "opens_at", "closes_at"] });
    const entitlements = [];
    for (const round of rounds) { const entitlement = await readAccessEntitlement({ rpcUrl: solana.rpcUrl, programId: round.program_id, roundPda: round.round_pda, wallet: req.wallet.address }); if (entitlement) entitlements.push({ package_id: round.package_id, round_state: effectiveAccessRoundState(round), ...entitlement, tier: tierName(entitlement.tier) }); }
    res.json({ entitlements });
  }));
  wallet.get("/wallet/auction-positions", route(async (req, res) => {
    const bids = await findDocs(db, "auction_bids", { wallet_id: req.wallet.wallet_id }, { sort: { placed_at: -1 } });
    const positions = [];
    for (const bid of bids) {
      const round = await findOneDoc(db, "access_rounds", { _id: bid.access_round_id, network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified" });
      if (!round) continue;
      const pkg = await findOneDoc(db, "dataset_packages", { _id: round.package_id });
      if (!pkg) continue;
      positions.push({ amount_lamports: bid.amount_lamports, tier: bid.tier, status: bid.status, placed_at: bid.placed_at, round_pda: round.round_pda, round_state: round.state, opens_at: round.opens_at, closes_at: round.closes_at, max_winners: round.max_winners, winners_count: round.winners_count, package_id: pkg.id, public_metadata: pkg.public_metadata });
    }
    res.json({ positions: positions.map((position) => ({ ...position, round_state: effectiveAccessRoundState(position) })) });
  }));
  async function protectedContext(req) {
    const context = await packageContext(db, req.params.packageId); if (!context || !context.dataset_pda || !context.round_pda) throw new Error("package_not_found");
    const entitlement = await readAccessEntitlement({ rpcUrl: solana.rpcUrl, programId: context.program_id, roundPda: context.round_pda, wallet: req.wallet.address });
    if (!entitlement || entitlement.datasetCommitment !== context.dataset_pda) throw new Error("entitlement_access_denied");
    const selected = await chooseProtectedVersion(db, context, entitlement);
    const objectKey = selected.redistribution_rights ? selected.normalized_object_key : selected.derivative_rights ? selected.derived_signal_object_key : null;
    if (!objectKey) throw new Error("licensed_artifact_unavailable");
    return { context: { ...selected, deliverable_object_key: objectKey }, grant: entitlement };
  }
  async function audited(req, action, resourceId, metadata = {}) { await repositories.audits.create({ actor_type: "wallet", actor_id: req.wallet.wallet_id, wallet_address: req.wallet.address, action, resource_type: "dataset_package", resource_id: resourceId, outcome: "allowed", metadata }); }
  wallet.get("/dataset/:packageId/view", route(async (req, res) => {
    const { context, grant } = await protectedContext(req);
    const bytes = await streamBytes(await artifactStore.getStream(context.deliverable_object_key));
    const reportBytes = await streamBytes(await artifactStore.getStream(context.report_object_key));
    await audited(req, "dataset_view_read", context.id, { entitlement_pda: grant.entitlementPda, dataset_version: context.dataset_version });
    res.json(buildDeliveredView({ context, grant, bytes, reportBytes }));
  }));
  wallet.get("/dataset/:packageId/metadata", route(async (req, res) => { const { context, grant } = await protectedContext(req); const bytes = await streamBytes(await artifactStore.getStream(context.private_metadata_object_key)); await audited(req, "dataset_metadata_read", context.id, { entitlement_pda: grant.entitlementPda }); res.type("application/json").send(bytes); }));
  wallet.get("/dataset/:packageId/report", route(async (req, res) => { const { context, grant } = await protectedContext(req); const bytes = await streamBytes(await artifactStore.getStream(context.report_object_key)); await audited(req, "dataset_report_read", context.id, { entitlement_pda: grant.entitlementPda }); res.type("application/json").send(bytes); }));
  wallet.get("/dataset/:packageId/:kind", route(async (req, res) => { if (!["data", "export"].includes(req.params.kind)) throw new Error("artifact_not_found"); const { context, grant } = await protectedContext(req); const stream = await artifactStore.getStream(context.deliverable_object_key); await audited(req, req.params.kind === "export" ? "dataset_export" : "dataset_data_read", context.id, { entitlement_pda: grant.entitlementPda, dataset_version: context.dataset_version, artifact_form: context.redistribution_rights ? "normalized" : "derived" }); res.type("application/x-ndjson"); if (req.params.kind === "export") res.setHeader("Content-Disposition", `attachment; filename="qarau-${context.id}-v${context.dataset_version}.jsonl"`); stream.pipe(res); }));
  router.use(wallet);
  return router;
}

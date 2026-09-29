import { asConflict, fromDoc, isDuplicateKey, newId, toDoc, withTransaction } from "../mongo.mjs";

function pgConflict(error) {
  return isDuplicateKey(error) ? asConflict(error) : error;
}

function selected(input, allowed) {
  const out = {};
  for (const column of allowed) {
    if (input[column] !== undefined) out[column] = input[column];
  }
  return out;
}

class Repository {
  constructor(db, collection, insertColumns = null) {
    if (!db || typeof db.collection !== "function") throw new Error("repository_database_required");
    this.db = db;
    this.col = db.collection(collection);
    this.table = collection;
    this.insertColumns = insertColumns ? Object.freeze(insertColumns) : null;
  }

  keyFor() {
    return undefined;
  }

  async findById(id) {
    return fromDoc(await this.col.findOne({ _id: id }));
  }

  async create(input) {
    const allowed = this.insertColumns ? selected(input, this.insertColumns) : { ...input };
    if (this.insertColumns && Object.keys(allowed).length === 0) throw new Error(`empty_insert:${this.table}`);
    const deterministic = this.keyFor(input);
    const doc = { ...allowed };
    delete doc.id;
    doc._id = deterministic ?? input.id ?? newId();
    if (doc.created_at === undefined && (this.insertColumns?.includes("created_at") || !this.insertColumns)) doc.created_at = new Date();
    try {
      await this.col.insertOne(doc);
    } catch (error) {
      throw pgConflict(error);
    }
    return fromDoc(doc);
  }

  /** ON CONFLICT DO NOTHING equivalent. Returns doc or null when it already exists. */
  async insertIgnore(input, filter = null) {
    try {
      return await this.create(input);
    } catch (error) {
      if (error?.code === "23505") return null;
      if (filter) return fromDoc(await this.col.findOne(filter));
      throw error;
    }
  }

  async updateById(id, patch) {
    const { id: _ignored, _id: _ignored2, ...rest } = patch;
    const result = await this.col.findOneAndUpdate({ _id: id }, { $set: rest }, { returnDocument: "after" });
    return fromDoc(result);
  }

  async findOneWhere(filter) {
    return fromDoc(await this.col.findOne(filter));
  }

  async findWhere(filter, { sort = null, limit = 0, skip = 0 } = {}) {
    let cursor = this.col.find(filter);
    if (sort) cursor = cursor.sort(sort);
    if (skip) cursor = cursor.skip(skip);
    if (limit) cursor = cursor.limit(limit);
    return (await cursor.toArray()).map(fromDoc);
  }

  async deleteWhere(filter) {
    const result = await this.col.deleteMany(filter);
    return result.deletedCount;
  }

  async countWhere(filter) {
    return this.col.countDocuments(filter);
  }
}

export class SourceRepository extends Repository {
  constructor(db) {
    super(db, "sources", ["id", "canonical_url_ciphertext", "canonical_url_hash", "domain", "title", "description", "source_type", "expected_fields", "temporal_coverage", "expected_update_interval", "status", "reliability", "next_scrape_at", "license_status", "redistribution_rights", "derivative_rights", "license_evidence_object_key", "license_evidence_hash", "license_reviewed_by", "license_reviewed_at", "discovered_at"]);
  }

  async findByCanonicalHash(hash) {
    return fromDoc(await this.col.findOne({ canonical_url_hash: hash }));
  }

  async listDue(limit = 100) {
    const candidates = await this.col.find({ status: "active", next_scrape_at: { $lte: new Date() } }).sort({ next_scrape_at: 1, _id: 1 }).limit(Math.max(limit * 5, limit)).toArray();
    if (!candidates.length) return [];
    const ids = candidates.map((doc) => doc._id);
    const busy = await this.db.collection("jobs").distinct("resource_id", { type: "scrape.source", resource_id: { $in: ids }, status: { $in: ["queued", "running", "retry_wait"] } });
    const busySet = new Set(busy);
    return candidates.filter((doc) => !busySet.has(doc._id)).slice(0, limit).map(fromDoc);
  }

  async markSuccess(id, nextScrapeAt) {
    const doc = { ...selected({ status: "active", last_successful_ingestion_at: new Date(), next_scrape_at: nextScrapeAt, updated_at: new Date() }, ["status", "last_successful_ingestion_at", "next_scrape_at", "updated_at"]) };
    const result = await this.col.findOneAndUpdate(
      { _id: id },
      { $set: doc, $unset: { "reliability.consecutive_failures": "" } },
      { returnDocument: "after" },
    );
    return fromDoc(result);
  }

  async markFailure(id, retryAt) {
    const current = await this.col.findOne({ _id: id }, { projection: { reliability: 1, status: 1 } });
    const failures = Number(current?.reliability?.consecutive_failures ?? 0) + 1;
    await this.col.findOneAndUpdate(
      { _id: id },
      {
        $set: {
          "reliability.consecutive_failures": failures,
          next_scrape_at: retryAt,
          status: failures >= 3 ? "broken" : current?.status ?? "active",
          updated_at: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    return failures;
  }
}

const VERSION_GRAPH = Object.freeze({
  allocated: ["normalizing", "failed"],
  normalizing: ["uploading", "failed"],
  uploading: ["stored", "failed"],
  stored: ["sealed", "failed"],
});

export class DatasetVersionRepository extends Repository {
  constructor(db) {
    super(db, "dataset_versions", ["id", "dataset_id", "source_snapshot_id", "version", "status", "normalized_object_key", "normalized_hash", "schema_profile", "quality_metrics", "coverage_start", "coverage_end", "frequency", "record_count", "missing_rate", "duplicate_rate", "outlier_rate", "continuity", "normalizer_version", "sealed_at"]);
  }

  async allocate(datasetId, sourceSnapshotId) {
    const datasets = this.db.collection("datasets");
    const bumped = await datasets.findOneAndUpdate(
      { _id: datasetId },
      { $inc: { current_version: 1 }, $set: { updated_at: new Date() } },
      { returnDocument: "after" },
    );
    if (!bumped) throw new Error("dataset_not_found");
    return this.create({ dataset_id: datasetId, source_snapshot_id: sourceSnapshotId, version: bumped.current_version, status: "allocated" });
  }

  async latestBefore(datasetId, version) {
    const doc = await this.col.find({ dataset_id: datasetId, version: { $lt: version } }).sort({ version: -1 }).limit(1).next();
    return fromDoc(doc);
  }

  async transition(id, fromStatus, toStatus, patch = {}) {
    if (!(VERSION_GRAPH[fromStatus] ?? []).includes(toStatus)) throw new Error("dataset_version_transition_conflict");
    const allowed = ["normalized_object_key", "normalized_hash", "schema_profile", "quality_metrics", "coverage_start", "coverage_end", "frequency", "record_count", "missing_rate", "duplicate_rate", "outlier_rate", "continuity", "normalizer_version", "sealed_at"];
    const result = await this.col.findOneAndUpdate(
      { _id: id, status: fromStatus },
      { $set: { status: toStatus, ...selected(patch, allowed) } },
      { returnDocument: "after" },
    );
    if (!result) throw new Error("dataset_version_transition_conflict");
    return fromDoc(result);
  }
}

export class AuditRepository extends Repository {
  constructor(db) {
    super(db, "audit_events", ["id", "actor_type", "actor_id", "wallet_address", "action", "resource_type", "resource_id", "request_id", "outcome", "ip_hash", "user_agent_hash", "metadata", "created_at"]);
  }
}

export class JobRepository extends Repository {
  constructor(db) {
    super(db, "jobs", ["id", "type", "payload_version", "payload", "status", "attempts", "max_attempts", "idempotency_key", "resource_type", "resource_id", "progress", "available_at", "lease_owner", "lease_until", "heartbeat_at", "result", "error_code", "error_detail", "created_at", "started_at", "completed_at", "updated_at"]);
  }

  async findByIdempotencyKey(idempotencyKey) {
    return fromDoc(await this.col.findOne({ idempotency_key: idempotencyKey }));
  }
}

export class DatasetRepository extends Repository {
  constructor(db) {
    super(db, "datasets", ["id", "source_id", "name", "semantic_schema", "current_version"]);
  }

  async findOrCreateForSource(sourceId, name) {
    const result = await this.col.findOneAndUpdate(
      { source_id: sourceId },
      { $setOnInsert: { _id: newId(), name, semantic_schema: {}, current_version: 0, created_at: new Date(), updated_at: new Date() } },
      { upsert: true, returnDocument: "after" },
    );
    return fromDoc(result);
  }
}

export class AnalysisRunRepository extends Repository {
  constructor(db) {
    super(db, "analysis_runs");
  }

  async markRunning(id) {
    return fromDoc(await this.col.findOneAndUpdate(
      { _id: id, status: { $in: ["queued", "failed", "running"] } },
      { $set: { status: "running", started_at: new Date(), error_code: null } },
      { returnDocument: "after" },
    ));
  }

  async markFinished(id, patch) {
    return this.updateById(id, { ...patch, completed_at: new Date() });
  }

  async markFailed(id, errorCode) {
    return this.updateById(id, { status: "failed", completed_at: new Date(), error_code: String(errorCode).slice(0, 128) });
  }
}

export class IngestionRunRepository extends Repository {
  constructor(db) {
    super(db, "ingestion_runs");
  }

  async finish(id, patch) {
    return this.updateById(id, { ...patch, status: "completed", finished_at: new Date() });
  }

  async markFailed(id, errorCode, errorDetail) {
    return this.updateById(id, { status: "failed", finished_at: new Date(), error_code: errorCode, error_detail: errorDetail });
  }
}

export class SignalCandidateRepository extends Repository {
  constructor(db) {
    super(db, "signal_candidates");
  }

  async findByFingerprint(analysisRunId, fingerprint) {
    return fromDoc(await this.col.findOne({ analysis_run_id: analysisRunId, semantic_fingerprint: fingerprint }, { projection: { _id: 1, artifact_object_key: 1, artifact_hash: 1 } }));
  }

  async deleteForAnalysis(analysisRunId) {
    const result = await this.col.deleteMany({ analysis_run_id: analysisRunId });
    return result.deletedCount;
  }
}

async function deleteByCandidateIds(db, collection, analysisRunId) {
  const ids = await db.collection("signal_candidates").distinct("_id", { analysis_run_id: analysisRunId });
  if (!ids.length) return 0;
  const result = await db.collection(collection).deleteMany({ signal_candidate_id: { $in: ids } });
  return result.deletedCount;
}

export class ScreeningResultRepository extends Repository {
  constructor(db) {
    super(db, "screening_results");
  }

  keyFor(input) {
    if (input.signal_candidate_id !== undefined && input.target_id !== undefined && input.horizon !== undefined) {
      return `${input.signal_candidate_id}::${input.target_id}::${input.horizon}`;
    }
    return undefined;
  }

  async deleteForAnalysis(analysisRunId) {
    return deleteByCandidateIds(this.db, "screening_results", analysisRunId);
  }
}

export class ValidationResultRepository extends Repository {
  constructor(db) {
    super(db, "validation_results");
  }

  keyFor(input) {
    if (input.analysis_run_id !== undefined && input.signal_candidate_id !== undefined && input.split !== undefined) {
      return `${input.analysis_run_id}::${input.signal_candidate_id}::${input.split}::${input.regime_name ?? ""}`;
    }
    return undefined;
  }

  async deleteForAnalysis(analysisRunId) {
    const result = await this.col.deleteMany({ analysis_run_id: analysisRunId });
    return result.deletedCount;
  }
}

export class LeakageCheckRepository extends Repository {
  constructor(db) {
    super(db, "leakage_check_results");
  }

  keyFor(input) {
    if (input.analysis_run_id !== undefined && input.check_type !== undefined) {
      return `${input.analysis_run_id}::${input.signal_candidate_id ?? ""}::${input.check_type}`;
    }
    return undefined;
  }

  async deleteForAnalysis(analysisRunId) {
    const result = await this.col.deleteMany({ analysis_run_id: analysisRunId });
    return result.deletedCount;
  }
}

export class AlphaScoreComponentRepository extends Repository {
  constructor(db) {
    super(db, "alpha_score_components");
  }

  keyFor(input) {
    if (input.analysis_run_id !== undefined && input.component !== undefined) {
      return `${input.analysis_run_id}::${input.component}`;
    }
    return undefined;
  }

  async deleteForAnalysis(analysisRunId) {
    const result = await this.col.deleteMany({ analysis_run_id: analysisRunId });
    return result.deletedCount;
  }
}

export class PackageRepository extends Repository {
  constructor(db) {
    super(db, "dataset_packages");
  }

  async commitIfSealed(id) {
    return fromDoc(await this.col.findOneAndUpdate(
      { _id: id, status: { $in: ["sealed", "commit_pending", "publication_failed"] } },
      { $set: { status: "committed" } },
      { returnDocument: "after" },
    ));
  }

  async setStatus(id, from, to) {
    return fromDoc(await this.col.findOneAndUpdate(
      { _id: id, status: { $in: from } },
      { $set: { status: to } },
      { returnDocument: "after" },
    ));
  }
}

export class CommitmentRepository extends Repository {
  constructor(db) {
    super(db, "blockchain_commitments");
  }

  async findByPackage(packageId) {
    return fromDoc(await this.col.findOne({ package_id: packageId }));
  }

  async upsertForPackage(packageId, doc) {
    const result = await this.col.findOneAndUpdate(
      { package_id: packageId },
      { $set: { ...doc, package_id: packageId, last_reconciled_at: new Date() }, $setOnInsert: { _id: newId(), created_at: new Date() } },
      { upsert: true, returnDocument: "after" },
    );
    return fromDoc(result);
  }
}

export class AccessRoundRepository extends Repository {
  constructor(db) {
    super(db, "access_rounds");
  }

  async findByPda(roundPda, network) {
    return fromDoc(await this.col.findOne({ round_pda: roundPda, network }));
  }

  async findPublicRound(roundPda) {
    return fromDoc(await this.col.findOne({ round_pda: roundPda, network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified" }));
  }

  async findSettleable(id) {
    return fromDoc(await this.col.findOne({ _id: id, network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified" }));
  }

  async upsertForPackage(packageId, doc) {
    const input = { ...doc };
    delete input.id;
    const result = await this.col.findOneAndUpdate(
      { package_id: packageId },
      { $set: { ...input, package_id: packageId, last_reconciled_at: new Date() }, $setOnInsert: { _id: newId(), created_at: new Date() } },
      { upsert: true, returnDocument: "after" },
    );
    return fromDoc(result);
  }

  /** Mirrors RECONCILE_UPDATE: monotonic slot, NULLIF(clearing,0), last_reconciled_at=now. */
  async reconcileUpdate(id, { state, bidCount, winnersCount, clearingPrice, slot, decodedState }) {
    const stored = await this.col.findOne({ _id: id }, { projection: { slot: 1 } });
    const result = await this.col.findOneAndUpdate(
      { _id: id },
      {
        $set: {
          state,
          bid_count: bidCount,
          winners_count: winnersCount,
          clearing_price_lamports: clearingPrice === 0 ? null : clearingPrice,
          slot: Math.max(Number(stored?.slot ?? 0), Number(slot ?? 0)),
          decoded_state: decodedState,
          last_reconciled_at: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    return fromDoc(result);
  }

  async settleUpdate(id, patch) {
    return this.updateById(id, { ...patch, confirmation_status: "finalized", chain_state_source: "rpc_verified", last_reconciled_at: new Date() });
  }

  async advanceTemporalState(id, state) {
    return fromDoc(await this.col.findOneAndUpdate(
      { _id: id, state: { $in: ["upcoming", "live", "ended"] } },
      { $set: { state, last_reconciled_at: new Date() } },
      { returnDocument: "after" },
    ));
  }

  async findStale(limit = 100, staleSeconds = 120) {
    const cutoff = new Date(Date.now() - staleSeconds * 1_000);
    return (await this.col.find({
      state: { $in: ["upcoming", "live", "ended"] },
      confirmation_status: "finalized",
      $or: [{ last_reconciled_at: null }, { last_reconciled_at: { $lt: cutoff } }],
    }).sort({ last_reconciled_at: 1 }).limit(limit).project({ round_pda: 1, network: 1 }).toArray()).map(fromDoc);
  }

  async listPublic() {
    return (await this.col.find({ network: "devnet", confirmation_status: "finalized", chain_state_source: "rpc_verified" }).project({ package_id: 1, round_pda: 1, program_id: 1, state: 1, opens_at: 1, closes_at: 1 }).toArray()).map(fromDoc);
  }
}

export class AuctionBidRepository extends Repository {
  constructor(db) {
    super(db, "auction_bids");
  }

  async upsertBid(accessRoundId, walletId, doc) {
    const input = { ...doc };
    delete input.id;
    const result = await this.col.findOneAndUpdate(
      { access_round_id: accessRoundId, wallet_id: walletId },
      { $set: { ...input, access_round_id: accessRoundId, wallet_id: walletId, last_reconciled_at: new Date() }, $setOnInsert: { _id: newId() } },
      { upsert: true, returnDocument: "after" },
    );
    return fromDoc(result);
  }

  async setStatus(accessRoundId, walletId, status, transactionSignature = null) {
    const patch = { status, last_reconciled_at: new Date() };
    if (transactionSignature !== null) patch.transaction_signature = transactionSignature;
    return fromDoc(await this.col.findOneAndUpdate({ access_round_id: accessRoundId, wallet_id: walletId }, { $set: patch }, { returnDocument: "after" }));
  }
}

export class EntitlementRepository extends Repository {
  constructor(db) {
    super(db, "access_entitlement_cache");
  }

  keyFor(input) {
    return input.entitlement_pda ?? undefined;
  }

  async upsertEntitlement(accessRoundId, walletId, doc) {
    const input = { ...doc };
    delete input.id;
    const result = await this.col.findOneAndUpdate(
      { access_round_id: accessRoundId, wallet_id: walletId },
      { $set: { ...input, access_round_id: accessRoundId, wallet_id: walletId, last_reconciled_at: new Date() }, $setOnInsert: { _id: input.entitlement_pda ?? newId() } },
      { upsert: true, returnDocument: "after" },
    );
    return fromDoc(result);
  }
}

export class SourceScreeningRepository extends Repository {
  constructor(db) {
    super(db, "source_screenings");
  }

  async upsertForSource(sourceId, doc) {
    const input = { ...doc };
    delete input.id;
    const result = await this.col.findOneAndUpdate(
      { source_id: sourceId },
      { $set: { ...input, source_id: sourceId }, $setOnInsert: { _id: newId(), screened_at: new Date() } },
      { upsert: true, returnDocument: "after" },
    );
    return fromDoc(result);
  }
}

export class MarketTargetRepository extends Repository {
  constructor(db) {
    super(db, "market_targets");
  }

  async findByProviderSymbol(provider, symbol) {
    return fromDoc(await this.col.findOne({ provider, symbol }));
  }
}

export class LegacyImportRunRepository extends Repository {
  constructor(db) {
    super(db, "legacy_import_runs");
  }

  async upsertByStateHash(doc) {
    const input = { ...doc };
    delete input.id;
    const result = await this.col.findOneAndUpdate(
      { source_state_hash: doc.source_state_hash },
      { $setOnInsert: { ...input, _id: doc.id ?? newId(), imported_at: new Date() } },
      { upsert: true, returnDocument: "after" },
    );
    return fromDoc(result);
  }
}

export class LegacyIdMapRepository extends Repository {
  constructor(db) {
    super(db, "legacy_id_map");
  }

  keyFor(input) {
    if (input.legacy_kind !== undefined && input.legacy_id !== undefined) {
      return `${input.legacy_kind}::${input.legacy_id}`;
    }
    return undefined;
  }
}

export function createRepositories(db) {
  void withTransaction;
  void toDoc;
  return Object.freeze({
    jobs: new JobRepository(db),
    sources: new SourceRepository(db),
    sourceScreenings: new SourceScreeningRepository(db),
    discoveries: new Repository(db, "source_discoveries", ["id", "source_id", "provider", "query", "result_rank", "result_url_hash", "provider_payload_hash", "discovered_at"]),
    ingestionRuns: new IngestionRunRepository(db),
    sourceSnapshots: new Repository(db, "source_snapshots", ["id", "source_id", "ingestion_run_id", "raw_object_key", "raw_hash", "retrieval_timestamp", "source_timestamp"]),
    datasets: new DatasetRepository(db),
    datasetVersions: new DatasetVersionRepository(db),
    marketTargets: new MarketTargetRepository(db),
    targetMappings: new Repository(db, "dataset_target_mappings", ["id", "dataset_id", "target_id", "physical_variable", "economic_mechanism", "affected_asset", "ai_rationale", "confidence", "status", "mapping_version", "approved_by", "approved_at"]),
    marketSnapshots: new Repository(db, "market_snapshots", ["id", "target_id", "raw_object_key", "normalized_object_key", "raw_hash", "normalized_hash", "retrieved_at", "coverage_start", "coverage_end"]),
    analysisRuns: new AnalysisRunRepository(db),
    signalCandidates: new SignalCandidateRepository(db),
    screeningResults: new ScreeningResultRepository(db),
    validationResults: new ValidationResultRepository(db),
    leakageChecks: new LeakageCheckRepository(db),
    alphaScoreComponents: new AlphaScoreComponentRepository(db),
    packages: new PackageRepository(db),
    commitments: new CommitmentRepository(db),
    accessRounds: new AccessRoundRepository(db),
    auctionBids: new AuctionBidRepository(db),
    accessEntitlements: new EntitlementRepository(db),
    sales: new Repository(db, "sales", ["id", "package_id", "sale_pda", "decoded_state", "observed_slot", "confirmation_status", "stale_after", "last_reconciled_at"]),
    purchases: new Repository(db, "purchases", ["id", "transaction_signature", "package_id", "sale_pda", "commitment_pda", "grant_pda", "wallet_id", "tier", "expected_lamports", "decoded_lamports", "observed_slot", "finalized_slot", "block_time", "confirmation_status", "validation_verdict", "validation_errors"]),
    audits: new AuditRepository(db),
    legacyImportRuns: new LegacyImportRunRepository(db),
    legacyIdMap: new LegacyIdMapRepository(db),
    legacyDerivations: new Repository(db, "legacy_dataset_derivations"),
    legacyAnalysisRecords: new Repository(db, "legacy_analysis_records"),
    legacyCommitmentRecords: new Repository(db, "legacy_commitment_records"),
  });
}

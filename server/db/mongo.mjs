import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";

export const COLLECTIONS = Object.freeze({
  schemaMigrations: "schema_migrations",
  sources: "sources",
  sourceDiscoveries: "source_discoveries",
  jobs: "jobs",
  ingestionRuns: "ingestion_runs",
  sourceSnapshots: "source_snapshots",
  datasets: "datasets",
  datasetVersions: "dataset_versions",
  marketTargets: "market_targets",
  datasetTargetMappings: "dataset_target_mappings",
  marketSnapshots: "market_snapshots",
  analysisRuns: "analysis_runs",
  signalCandidates: "signal_candidates",
  screeningResults: "screening_results",
  validationResults: "validation_results",
  leakageChecks: "leakage_check_results",
  alphaScoreComponents: "alpha_score_components",
  packages: "dataset_packages",
  commitments: "blockchain_commitments",
  sales: "sales",
  userWallets: "user_wallets",
  walletNonces: "wallet_nonces",
  walletSessions: "wallet_sessions",
  accessGrants: "access_grant_cache",
  accessRounds: "access_rounds",
  auctionBids: "auction_bids",
  accessEntitlements: "access_entitlement_cache",
  purchases: "purchases",
  auditEvents: "audit_events",
  pipelineStageRuns: "pipeline_stage_runs",
  sourceScreenings: "source_screenings",
  legacyImportRuns: "legacy_import_runs",
  legacyIdMap: "legacy_id_map",
  legacyDerivations: "legacy_dataset_derivations",
  legacyAnalysisRecords: "legacy_analysis_records",
  legacyCommitmentRecords: "legacy_commitment_records",
});

export function newId() {
  return randomUUID();
}

/** Plain `{id, ...rest}` -> Mongo `{_id, ...rest}`. */
export function toDoc(input) {
  if (!input || typeof input !== "object") throw new Error("invalid_document");
  const { id, ...rest } = input;
  return { ...rest, _id: id ?? newId() };
}

/** Mongo `{_id, ...rest}` -> plain `{id, ...rest}`. Null-safe. */
export function fromDoc(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { ...rest, id: _id };
}

export function isDuplicateKey(error) {
  return error?.code === 11000 || error?.code === "23505";
}

export function asConflict(error) {
  if (error && error.code !== "23505") {
    try {
      error.code = "23505";
    } catch {}
  }
  return error;
}

export async function createDatabase(uri = process.env.MONGODB_URI, dbName = process.env.MONGODB_DB ?? "qarau") {
  if (!uri) throw new Error("mongodb_uri_required");
  const client = new MongoClient(uri, { maxPoolSize: Number(process.env.MONGODB_POOL_MAX ?? 10), serverSelectionTimeoutMS: 5_000, promoteBuffers: true });
  await client.connect();
  const db = client.db(dbName);
  return Object.freeze({
    client,
    db,
    async close() {
      await client.close().catch(() => {});
    },
  });
}

/**
 * Runs fn(session) inside a transaction when the deployment supports it
 * (replica set / Atlas). Falls back to plain execution (no session) on
 * standalone servers so local dev without replica set still works.
 */
export async function withTransaction(client, fn) {
  const session = client.startSession();
  try {
    let result;
    try {
      await session.withTransaction(async () => {
        result = await fn(session);
      });
    } catch (error) {
      if (error?.errorLabels?.includes("TransientTransactionError") || /transaction numbers|replica set|standalone/i.test(String(error?.message))) {
        result = await fn(undefined);
      } else {
        throw error;
      }
    }
    return result;
  } finally {
    await session.endSession().catch(() => {});
  }
}

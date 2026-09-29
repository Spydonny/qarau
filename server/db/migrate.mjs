import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./mongo.mjs";

const MIGRATION_VERSION = "mongo_init_v1";

function indexSpecs() {
  return [
    // UNIQUE constraints (were SQL UNIQUE / PK-adjacent)
    ["sources", [{ key: { canonical_url_hash: 1 }, unique: true }]],
    ["source_discoveries", []],
    ["jobs", [{ key: { idempotency_key: 1 }, unique: true }]],
    ["ingestion_runs", [{ key: { job_id: 1, attempt: 1 }, unique: true, sparse: true }]],
    ["source_snapshots", [{ key: { ingestion_run_id: 1 }, unique: true }, { key: { raw_object_key: 1 }, unique: true }]],
    ["datasets", [{ key: { source_id: 1 }, unique: true }]],
    ["dataset_versions", [
      { key: { source_snapshot_id: 1 }, unique: true },
      { key: { dataset_id: 1, version: -1 }, unique: true },
    ]],
    ["market_targets", [{ key: { provider: 1, symbol: 1 }, unique: true }]],
    ["dataset_target_mappings", [{ key: { dataset_id: 1, target_id: 1, mapping_version: 1 }, unique: true }]],
    ["market_snapshots", [
      { key: { raw_object_key: 1 }, unique: true },
      { key: { normalized_object_key: 1 }, unique: true },
    ]],
    ["analysis_runs", [{ key: { best_signal_candidate_id: 1 }, sparse: true }]],
    ["signal_candidates", [{ key: { analysis_run_id: 1, semantic_fingerprint: 1 }, unique: true }]],
    ["screening_results", []],
    ["validation_results", []],
    ["leakage_check_results", []],
    ["alpha_score_components", []],
    ["dataset_packages", [{ key: { dataset_version_id: 1, analysis_run_id: 1 }, unique: true }]],
    ["blockchain_commitments", [
      { key: { package_id: 1 }, unique: true },
      { key: { dataset_pda: 1 }, unique: true, sparse: true },
      { key: { transaction_signature: 1 }, unique: true, sparse: true },
    ]],
    ["sales", [
      { key: { package_id: 1 }, unique: true },
      { key: { sale_pda: 1 }, unique: true },
    ]],
    ["user_wallets", [{ key: { address: 1 }, unique: true }]],
    ["wallet_nonces", [{ key: { nonce_hash: 1 }, unique: true }]],
    ["wallet_sessions", []],
    ["access_grant_cache", [
      { key: { grant_pda: 1 }, unique: true },
      { key: { package_id: 1, wallet_id: 1 }, unique: true },
    ]],
    ["access_rounds", [
      { key: { package_id: 1 }, unique: true, sparse: true },
      { key: { round_pda: 1 }, unique: true },
      { key: { transaction_signature: 1 }, unique: true, sparse: true },
    ]],
    ["auction_bids", [
      { key: { bid_pda: 1 }, unique: true },
      { key: { transaction_signature: 1 }, unique: true },
      { key: { access_round_id: 1, wallet_id: 1 }, unique: true },
    ]],
    ["access_entitlement_cache", [
      { key: { entitlement_pda: 1 }, unique: true },
      { key: { access_round_id: 1, wallet_id: 1 }, unique: true },
      { key: { transaction_signature: 1 }, unique: true },
    ]],
    ["purchases", [{ key: { transaction_signature: 1 }, unique: true }]],
    ["audit_events", []],
    ["pipeline_stage_runs", [
      { key: { job_id: 1 }, unique: false },
      { key: { idempotency_key: 1 }, unique: true },
    ]],
    ["source_screenings", [{ key: { source_id: 1 }, unique: true }]],
    ["legacy_import_runs", [{ key: { source_state_hash: 1 }, unique: true }]],
    ["legacy_id_map", []],
    ["legacy_dataset_derivations", [{ key: { dataset_id: 1, legacy_rows_hash: 1 }, unique: true }]],
    ["legacy_analysis_records", [{ key: { legacy_test_id: 1 }, unique: true }]],
    ["legacy_commitment_records", [{ key: { legacy_commitment_id: 1 }, unique: true }]],
    // Lookup indexes (were SQL CREATE INDEX)
    ["jobs_lookup", [
      { collection: "jobs", key: { status: 1, available_at: 1, created_at: 1 } },
      { collection: "jobs", key: { status: 1, lease_until: 1 } },
    ]],
    ["sources_lookup", [{ collection: "sources", key: { status: 1, next_scrape_at: 1 } }]],
    ["ingestion_runs_lookup", [{ collection: "ingestion_runs", key: { source_id: 1, created_at: -1 } }]],
    ["analysis_runs_lookup", [{ collection: "analysis_runs", key: { dataset_version_id: 1, created_at: -1 } }]],
    ["audit_events_lookup", [{ collection: "audit_events", key: { resource_type: 1, resource_id: 1, created_at: -1 } }]],
    ["screenings_lookup", [{ collection: "source_screenings", key: { passed: 1, screened_at: -1 } }]],
    ["rounds_lookup", [{ collection: "access_rounds", key: { state: 1, opens_at: 1, closes_at: 1 } }]],
    ["bids_lookup", [{ collection: "auction_bids", key: { access_round_id: 1, amount_lamports: -1, placed_at: 1 } }]],
    ["entitlements_lookup", [{ collection: "access_entitlement_cache", key: { wallet_id: 1, status: 1, expires_at: 1 } }]],
  ];
}

function checksum(specs) {
  return createHash("sha256").update(JSON.stringify(specs), "utf8").digest("hex");
}

/**
 * Idempotent Atlas setup: creates collections and unique/lookup indexes.
 * Replaces the SQL migration chain (server/db/migrations/*.sql).
 */
export async function migrate(db) {
  if (!db || typeof db.collection !== "function") throw new Error("migrate_database_required");
  const specs = indexSpecs();
  const versions = db.collection("schema_migrations");
  const existing = await versions.findOne({ _id: MIGRATION_VERSION });
  if (!existing) {
    for (const [name] of specs) {
      if (name.endsWith("_lookup")) continue;
      try {
        await db.createCollection(name);
      } catch (error) {
        if (error?.codeName !== "NamespaceExists") throw error;
      }
    }
    // Create indexes: entries are [collectionName, indexDefs] or [lookupGroup, [{collection,...}]]
    for (const [name, list] of specs) {
      if (name.endsWith("_lookup")) {
        for (const spec of list) {
          await db.collection(spec.collection).createIndex(spec.key, { background: true });
        }
      } else {
        const collection = db.collection(name);
        for (const def of list) {
          await collection.createIndex(def.key, {
            ...(def.unique ? { unique: true } : {}),
            ...(def.sparse ? { sparse: true } : {}),
            background: true,
          });
        }
      }
    }
    await versions.insertOne({ _id: MIGRATION_VERSION, checksum: checksum(specs), applied_at: new Date() });
    return Object.freeze({ applied: [MIGRATION_VERSION], total: 1 });
  }
  if (existing.checksum !== checksum(specs)) throw new Error(`migration_checksum_mismatch:${MIGRATION_VERSION}`);
  return Object.freeze({ applied: [], total: 1 });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { db, close } = await createDatabase();
  try {
    const result = await migrate(db);
    console.log(JSON.stringify({ event: "database_migrated", ...result }));
  } finally {
    await close();
  }
}

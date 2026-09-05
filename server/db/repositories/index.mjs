import { inTransaction } from "../pool.mjs";

function selected(input, allowed) {
  return allowed.filter((column) => input[column] !== undefined);
}

async function insert(client, table, allowed, input) {
  const columns = selected(input, allowed);
  if (columns.length === 0) throw new Error(`empty_insert:${table}`);
  const values = columns.map((column) => input[column]);
  const parameters = columns.map((_, index) => `$${index + 1}`).join(", ");
  const result = await client.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${parameters}) RETURNING *`, values);
  return result.rows[0];
}

class Repository {
  constructor(pool, table, insertColumns) {
    this.pool = pool;
    this.table = table;
    this.insertColumns = Object.freeze(insertColumns);
  }

  async findById(id, client = this.pool) {
    const result = await client.query(`SELECT * FROM ${this.table} WHERE id = $1`, [id]);
    return result.rows[0] ?? null;
  }

  async create(input, client = this.pool) {
    return insert(client, this.table, this.insertColumns, input);
  }
}

export class SourceRepository extends Repository {
  constructor(pool) {
    super(pool, "sources", ["id", "canonical_url_ciphertext", "canonical_url_hash", "domain", "title", "description", "source_type", "expected_fields", "temporal_coverage", "expected_update_interval", "status", "reliability", "next_scrape_at", "license_status", "redistribution_rights", "derivative_rights", "license_evidence_object_key", "license_evidence_hash", "license_reviewed_by", "license_reviewed_at", "discovered_at"]);
  }

  async findByCanonicalHash(hash, client = this.pool) {
    const result = await client.query("SELECT * FROM sources WHERE canonical_url_hash = $1", [hash]);
    return result.rows[0] ?? null;
  }

  async listDue(limit = 100, client = this.pool) {
    const result = await client.query("SELECT * FROM sources WHERE status = 'active' AND next_scrape_at <= now() ORDER BY next_scrape_at, id LIMIT $1", [limit]);
    return result.rows;
  }
}

export class DatasetVersionRepository extends Repository {
  constructor(pool) {
    super(pool, "dataset_versions", ["id", "dataset_id", "source_snapshot_id", "version", "status", "normalized_object_key", "normalized_hash", "schema_profile", "quality_metrics", "coverage_start", "coverage_end", "frequency", "record_count", "missing_rate", "duplicate_rate", "outlier_rate", "continuity", "normalizer_version", "sealed_at"]);
  }

  async allocate(datasetId, sourceSnapshotId) {
    return inTransaction(this.pool, async (client) => {
      const dataset = await client.query("SELECT current_version FROM datasets WHERE id = $1 FOR UPDATE", [datasetId]);
      if (!dataset.rowCount) throw new Error("dataset_not_found");
      const version = dataset.rows[0].current_version + 1;
      const created = await this.create({ dataset_id: datasetId, source_snapshot_id: sourceSnapshotId, version, status: "allocated" }, client);
      await client.query("UPDATE datasets SET current_version = $2, updated_at = now() WHERE id = $1", [datasetId, version]);
      return created;
    });
  }

  async latestBefore(datasetId, version, client = this.pool) {
    const result = await client.query("SELECT * FROM dataset_versions WHERE dataset_id = $1 AND version < $2 ORDER BY version DESC LIMIT 1", [datasetId, version]);
    return result.rows[0] ?? null;
  }

  async transition(id, fromStatus, toStatus, patch = {}) {
    const allowed = ["normalized_object_key", "normalized_hash", "schema_profile", "quality_metrics", "coverage_start", "coverage_end", "frequency", "record_count", "missing_rate", "duplicate_rate", "outlier_rate", "continuity", "normalizer_version", "sealed_at"];
    const columns = selected(patch, allowed);
    const assignments = ["status = $3", ...columns.map((column, index) => `${column} = $${index + 4}`)];
    const values = [id, fromStatus, toStatus, ...columns.map((column) => patch[column])];
    const result = await this.pool.query(`UPDATE dataset_versions SET ${assignments.join(", ")} WHERE id = $1 AND status = $2 RETURNING *`, values);
    if (!result.rowCount) throw new Error("dataset_version_transition_conflict");
    return result.rows[0];
  }
}

export class AuditRepository extends Repository {
  constructor(pool) {
    super(pool, "audit_events", ["id", "actor_type", "actor_id", "wallet_address", "action", "resource_type", "resource_id", "request_id", "outcome", "ip_hash", "user_agent_hash", "metadata", "created_at"]);
  }
}

export class JobRepository extends Repository {
  constructor(pool) {
    super(pool, "jobs", ["id", "type", "payload_version", "payload", "status", "attempts", "max_attempts", "idempotency_key", "resource_type", "resource_id", "progress", "available_at", "lease_owner", "lease_until", "heartbeat_at", "result", "error_code", "error_detail", "created_at", "started_at", "completed_at", "updated_at"]);
  }

  async findByIdempotencyKey(idempotencyKey, client = this.pool) {
    const result = await client.query("SELECT * FROM jobs WHERE idempotency_key = $1", [idempotencyKey]);
    return result.rows[0] ?? null;
  }
}

export class DatasetRepository extends Repository {
  constructor(pool) { super(pool, "datasets", ["id", "source_id", "name", "semantic_schema", "current_version"]); }

  async findOrCreateForSource(sourceId, name) {
    return inTransaction(this.pool, async (client) => {
      const existing = await client.query("SELECT * FROM datasets WHERE source_id = $1 FOR UPDATE", [sourceId]);
      if (existing.rowCount) return existing.rows[0];
      return this.create({ source_id: sourceId, name, semantic_schema: {} }, client);
    });
  }
}

export function createRepositories(pool) {
  return Object.freeze({
    jobs: new JobRepository(pool),
    sources: new SourceRepository(pool),
    discoveries: new Repository(pool, "source_discoveries", ["id", "source_id", "provider", "query", "result_rank", "result_url_hash", "provider_payload_hash", "discovered_at"]),
    ingestionRuns: new Repository(pool, "ingestion_runs", ["id", "source_id", "job_id", "status", "attempt", "started_at", "retrieved_at", "source_timestamp", "finished_at", "http_status", "result_status", "response_headers", "content_type", "content_length", "content_hash", "raw_object_key", "parser_name", "parser_version", "record_count", "change_type", "previous_run_id", "error_code", "error_detail"]),
    sourceSnapshots: new Repository(pool, "source_snapshots", ["id", "source_id", "ingestion_run_id", "raw_object_key", "raw_hash", "retrieval_timestamp", "source_timestamp"]),
    datasets: new DatasetRepository(pool),
    datasetVersions: new DatasetVersionRepository(pool),
    marketTargets: new Repository(pool, "market_targets", ["id", "symbol", "asset_class", "provider", "calendar", "timezone", "currency", "status"]),
    targetMappings: new Repository(pool, "dataset_target_mappings", ["id", "dataset_id", "target_id", "physical_variable", "economic_mechanism", "affected_asset", "ai_rationale", "confidence", "status", "mapping_version", "approved_by", "approved_at"]),
    marketSnapshots: new Repository(pool, "market_snapshots", ["id", "target_id", "raw_object_key", "normalized_object_key", "raw_hash", "normalized_hash", "retrieved_at", "coverage_start", "coverage_end"]),
    analysisRuns: new Repository(pool, "analysis_runs", ["id", "dataset_version_id", "market_snapshot_id", "mapping_id", "status", "pipeline_version", "manifest_object_key", "manifest_hash", "result_object_key", "result_hash", "report_object_key", "started_at", "completed_at", "error_code", "alpha_score", "score_version", "blocking_leakage"]),
    packages: new Repository(pool, "dataset_packages", ["id", "dataset_version_id", "analysis_run_id", "status", "public_metadata", "private_metadata_object_key", "access_policy", "access_policy_object_key", "access_policy_hash", "max_seats", "raw_snapshot_hash", "normalized_dataset_hash", "analysis_manifest_hash", "analysis_result_hash", "sealed_at", "created_by"]),
    commitments: new Repository(pool, "blockchain_commitments", ["id", "package_id", "network", "program_id", "dataset_pda", "transaction_signature", "slot", "confirmation_status", "decoded_account", "verified_at", "last_reconciled_at"]),
    sales: new Repository(pool, "sales", ["id", "package_id", "sale_pda", "decoded_state", "observed_slot", "confirmation_status", "stale_after", "last_reconciled_at"]),
    purchases: new Repository(pool, "purchases", ["id", "transaction_signature", "package_id", "sale_pda", "commitment_pda", "grant_pda", "wallet_id", "tier", "expected_lamports", "decoded_lamports", "observed_slot", "finalized_slot", "block_time", "confirmation_status", "validation_verdict", "validation_errors"]),
    audits: new AuditRepository(pool),
  });
}

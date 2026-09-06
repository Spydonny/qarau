import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { createPool } from "../db/pool.mjs";
import { migrate } from "../db/migrate.mjs";
import { createRepositories } from "../db/repositories/index.mjs";
import { createAnalysisRunHandler } from "../jobs/handlers/analysis-run.mjs";
import { normalizeRows } from "../normalization/canonical-jsonl.mjs";
import { encryptSourceUrl } from "../security/source-url.mjs";
import { testDatabaseUrl } from "./database-url.mjs";

const databaseUrl = testDatabaseUrl();
const sourceKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
class MemoryArtifacts {
  constructor() { this.values = new Map(); }
  async putOnce({ key, bytes, artifactHash, contentType }) { this.values.set(key, { bytes: Buffer.from(bytes), artifactHash, contentType }); }
  async getStream(key) { const value = this.values.get(key); if (!value) throw new Error(`missing:${key}`); return Readable.from(value.bytes); }
}

test("analysis worker persists signal, screening, validation, leakage and score artifacts", { skip: !databaseUrl }, async () => {
  const pool = createPool(databaseUrl); const artifacts = new MemoryArtifacts(); const suffix = randomUUID();
  try {
    await migrate(pool); const repositories = createRepositories(pool);
    const source = await repositories.sources.create({ canonical_url_ciphertext: encryptSourceUrl("https://example.test/data", sourceKey), canonical_url_hash: createHash("sha256").update(suffix).digest(), domain: "example.test", source_type: "json_api", status: "active" });
    const ingestion = await repositories.ingestionRuns.create({ source_id: source.id, status: "completed", attempt: 1 });
    const snapshot = await repositories.sourceSnapshots.create({ source_id: source.id, ingestion_run_id: ingestion.id, raw_object_key: `raw/${source.id}/${suffix}/body`, raw_hash: Buffer.alloc(32, 1), retrieval_timestamp: new Date() });
    const dataset = await repositories.datasets.findOrCreateForSource(source.id, "analysis fixture");
    const start = Date.UTC(2024, 0, 1);
    const sourceRows = Array.from({ length: 240 }, (_, index) => ({ timestamp: new Date(start + index * 86_400_000).toISOString(), availableAt: new Date(start + index * 86_400_000).toISOString(), values: { flow: Math.sin(index / 7) + index / 500 } }));
    const normalized = normalizeRows(sourceRows, { valueFields: ["flow"] }); const sourceKeyName = `normalized/${dataset.id}/v1/data.jsonl`;
    await artifacts.putOnce({ key: sourceKeyName, bytes: normalized.bytes, artifactHash: normalized.hash });
    let version = await repositories.datasetVersions.allocate(dataset.id, snapshot.id); version = await repositories.datasetVersions.transition(version.id, "allocated", "normalizing"); version = await repositories.datasetVersions.transition(version.id, "normalizing", "uploading"); version = await repositories.datasetVersions.transition(version.id, "uploading", "stored", { normalized_object_key: sourceKeyName, normalized_hash: Buffer.from(normalized.hash, "hex"), schema_profile: { value_fields: ["flow"] }, quality_metrics: normalized.quality, coverage_start: normalized.quality.coverage_start, coverage_end: normalized.quality.coverage_end, frequency: normalized.quality.frequency, record_count: normalized.rows.length, normalizer_version: "1" }); version = await repositories.datasetVersions.transition(version.id, "stored", "sealed", { sealed_at: new Date() });
    const target = await repositories.marketTargets.create({ symbol: `BTC-${suffix.slice(0, 4)}`, provider: "fixture", asset_class: "crypto", calendar: "24x7", timezone: "UTC", currency: "USD", status: "active" });
    let price = 100; const prices = sourceRows.map((row, index) => { price *= 1 + (index > 3 ? Number(sourceRows[index - 3].values.flow) * .001 : 0); return { timestamp: row.timestamp, availableAt: row.timestamp, values: { price } }; });
    const marketNormalized = normalizeRows(prices, { valueFields: ["price"] }); const marketKey = `normalized/markets/${target.id}/${suffix}/prices.jsonl`;
    await artifacts.putOnce({ key: marketKey, bytes: marketNormalized.bytes, artifactHash: marketNormalized.hash });
    const market = await repositories.marketSnapshots.create({ target_id: target.id, raw_object_key: `raw/markets/${target.id}/${suffix}/raw`, normalized_object_key: marketKey, raw_hash: Buffer.alloc(32, 2), normalized_hash: Buffer.from(marketNormalized.hash, "hex"), retrieved_at: new Date(), coverage_start: marketNormalized.quality.coverage_start, coverage_end: marketNormalized.quality.coverage_end });
    const mapping = await repositories.targetMappings.create({ dataset_id: dataset.id, target_id: target.id, physical_variable: "flow", economic_mechanism: "fixture", affected_asset: target.symbol, status: "proposed", mapping_version: 1 });
    const run = await repositories.analysisRuns.create({ dataset_version_id: version.id, market_snapshot_id: market.id, mapping_id: mapping.id, status: "queued", pipeline_version: "quantitative-v1" });
    const result = await createAnalysisRunHandler({ pool, artifactStore: artifacts })({ payload: { analysisRunId: run.id } });
    assert.equal(result.status, "completed");
    const redelivery = await createAnalysisRunHandler({ pool, artifactStore: artifacts })({ payload: { analysisRunId: run.id } });
    assert.equal(redelivery.alreadyProcessed, true);
    assert.equal(redelivery.status, "completed");
    const persisted = await pool.query("SELECT status, alpha_score, manifest_hash, result_hash FROM analysis_runs WHERE id = $1", [run.id]);
    assert.equal(persisted.rows[0].status, "completed"); assert.ok(Number(persisted.rows[0].alpha_score) >= 0); assert.equal(Buffer.from(persisted.rows[0].manifest_hash).length, 32);
    const counts = await pool.query("SELECT (SELECT count(*) FROM signal_candidates WHERE analysis_run_id = $1)::integer AS signals, (SELECT count(*) FROM validation_results WHERE analysis_run_id = $1)::integer AS validations, (SELECT count(*) FROM leakage_check_results WHERE analysis_run_id = $1)::integer AS checks", [run.id]);
    assert.ok(counts.rows[0].signals > 0 && counts.rows[0].validations > 0 && counts.rows[0].checks > 0);
  } finally { await pool.end(); }
});

import { createRepositories } from "../../db/repositories/index.mjs";
import { captureRawSnapshot } from "../../ingestion/fetch.mjs";
import { diffNormalizedRows, normalizeRows } from "../../normalization/canonical-jsonl.mjs";
import { decryptSourceUrl } from "../../security/source-url.mjs";

function parseJsonRows(bytes) {
  let payload;
  try { payload = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("invalid_source_json"); }
  const rows = Array.isArray(payload) ? payload : payload?.data ?? payload?.rows;
  if (!Array.isArray(rows)) throw new Error("unsupported_json_source_shape");
  return rows.map((row) => ({ timestamp: row?.timestamp ?? row?.date ?? row?.time, availableAt: row?.available_at ?? row?.availableAt ?? row?.timestamp ?? row?.date ?? row?.time, value: row?.value }));
}

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function readJsonl(stream) {
  return (await readStream(stream)).toString("utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function nextScrapeAt() {
  return new Date(Date.now() + 24 * 60 * 60 * 1_000);
}

/** Executes the full raw-capture → normalized immutable-version workflow. */
export function createScrapeSourceHandler({ pool, artifactStore, sourceUrlKey = process.env.SOURCE_URL_ENCRYPTION_KEY, requestBytes }) {
  if (!pool || !artifactStore) throw new Error("scrape_handler_dependencies_required");
  const repositories = createRepositories(pool);
  return async function scrapeSource(job) {
    const sourceId = job.payload.sourceId;
    const source = await repositories.sources.findById(sourceId);
    if (!source || source.status !== "active") throw new Error("active_source_not_found");
    if (source.source_type !== "json_api") throw new Error("source_parser_not_implemented");
    const url = decryptSourceUrl(source.canonical_url_ciphertext, sourceUrlKey);
    const run = await repositories.ingestionRuns.create({ source_id: sourceId, job_id: job.id, status: "running", attempt: job.attempts, started_at: new Date() });
    let version;
    try {
      const snapshot = await captureRawSnapshot({ sourceId, url, artifactStore, requestBytes });
      const sourceSnapshot = await repositories.sourceSnapshots.create({ id: snapshot.snapshotId, source_id: sourceId, ingestion_run_id: run.id, raw_object_key: snapshot.rawObjectKey, raw_hash: Buffer.from(snapshot.rawHash, "hex"), retrieval_timestamp: snapshot.retrievedAt });
      const dataset = await repositories.datasets.findOrCreateForSource(sourceId, source.title ?? source.domain);
      version = await repositories.datasetVersions.allocate(dataset.id, sourceSnapshot.id);
      version = await repositories.datasetVersions.transition(version.id, "allocated", "normalizing");
      const normalized = normalizeRows(parseJsonRows(await readStream(await artifactStore.getStream(snapshot.rawObjectKey))));
      const previous = await repositories.datasetVersions.latestBefore(dataset.id, version.version);
      const previousRows = previous?.normalized_object_key ? await readJsonl(await artifactStore.getStream(previous.normalized_object_key)) : null;
      const change = diffNormalizedRows(previousRows, normalized.rows);
      const normalizedKey = `normalized/${dataset.id}/v${version.version}/data.jsonl`;
      version = await repositories.datasetVersions.transition(version.id, "normalizing", "uploading");
      await artifactStore.putOnce({ key: normalizedKey, bytes: normalized.bytes, artifactHash: normalized.hash, contentType: "application/x-ndjson" });
      const coverageStart = normalized.rows[0].timestamp;
      const coverageEnd = normalized.rows.at(-1).timestamp;
      version = await repositories.datasetVersions.transition(version.id, "uploading", "stored", { normalized_object_key: normalizedKey, normalized_hash: Buffer.from(normalized.hash, "hex"), schema_profile: { value_field: "value" }, quality_metrics: { record_count: normalized.rows.length }, coverage_start: coverageStart, coverage_end: coverageEnd, record_count: normalized.rows.length, normalizer_version: normalized.normalizerVersion });
      const sealed = await repositories.datasetVersions.transition(version.id, "stored", "sealed", { sealed_at: new Date() });
      await pool.query(`UPDATE ingestion_runs SET status = 'completed', retrieved_at = $2, finished_at = now(), response_headers = $3, content_type = $4, content_length = $5, content_hash = $6, raw_object_key = $7, parser_name = 'json_rows_v1', parser_version = '1', record_count = $8, change_type = $9 WHERE id = $1`, [run.id, snapshot.retrievedAt, snapshot.responseHeaders, snapshot.contentType, snapshot.contentLength, Buffer.from(snapshot.rawHash, "hex"), snapshot.rawObjectKey, normalized.rows.length, change.changeType]);
      await pool.query("UPDATE sources SET last_successful_ingestion_at = now(), next_scrape_at = $2, updated_at = now() WHERE id = $1", [sourceId, nextScrapeAt()]);
      return { sourceId, ingestionRunId: run.id, datasetVersionId: sealed.id, version: sealed.version, changeType: change.changeType, normalizedHash: normalized.hash };
    } catch (error) {
      if (version) await repositories.datasetVersions.transition(version.id, version.status === "allocated" ? "allocated" : version.status, "failed").catch(() => {});
      await pool.query("UPDATE ingestion_runs SET status = 'failed', finished_at = now(), error_code = $2, error_detail = $3 WHERE id = $1", [run.id, "scrape_failed", String(error.message).slice(0, 1_000)]);
      throw error;
    }
  };
}

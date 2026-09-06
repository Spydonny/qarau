import { createRepositories } from "../../db/repositories/index.mjs";
import { captureRawSnapshot } from "../../ingestion/fetch.mjs";
import { diffNormalizedRows, normalizeRows } from "../../normalization/canonical-jsonl.mjs";
import { parseSourceBytes } from "../../ingestion/parsers.mjs";
import { decryptSourceUrl } from "../../security/source-url.mjs";

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

function retryAt(failures) {
  const hours = Math.min(24 * 7, 2 ** Math.min(failures, 8));
  return new Date(Date.now() + hours * 60 * 60 * 1_000);
}

async function markSourceFailure(pool, sourceId) {
  const result = await pool.query(
    `UPDATE sources
     SET reliability = jsonb_set(COALESCE(reliability, '{}'::jsonb), '{consecutive_failures}', to_jsonb(COALESCE((reliability->>'consecutive_failures')::integer, 0) + 1), true),
         next_scrape_at = $2,
         status = CASE WHEN COALESCE((reliability->>'consecutive_failures')::integer, 0) + 1 >= 3 THEN 'broken'::source_status ELSE status END,
         updated_at = now()
     WHERE id = $1
     RETURNING reliability`,
    [sourceId, new Date(Date.now() + 60 * 60 * 1_000)],
  );
  const failures = Number(result.rows[0]?.reliability?.consecutive_failures ?? 1);
  await pool.query("UPDATE sources SET next_scrape_at = $2 WHERE id = $1", [sourceId, retryAt(failures)]);
  return failures;
}

/** Executes the full raw-capture → normalized immutable-version workflow. */
export function createScrapeSourceHandler({ pool, artifactStore, sourceUrlKey = process.env.SOURCE_URL_ENCRYPTION_KEY, requestBytes }) {
  if (!pool || !artifactStore) throw new Error("scrape_handler_dependencies_required");
  const repositories = createRepositories(pool);
  return async function scrapeSource(job) {
    const sourceId = job.payload.sourceId;
    const source = await repositories.sources.findById(sourceId);
    if (!source || source.status !== "active") throw new Error("active_source_not_found");
    const url = decryptSourceUrl(source.canonical_url_ciphertext, sourceUrlKey);
    const run = await repositories.ingestionRuns.create({ source_id: sourceId, job_id: job.id, status: "running", attempt: job.attempts, started_at: new Date() });
    let version;
    try {
      const snapshot = await captureRawSnapshot({ sourceId, url, artifactStore, requestBytes });
      const sourceSnapshot = await repositories.sourceSnapshots.create({ id: snapshot.snapshotId, source_id: sourceId, ingestion_run_id: run.id, raw_object_key: snapshot.rawObjectKey, raw_hash: Buffer.from(snapshot.rawHash, "hex"), retrieval_timestamp: snapshot.retrievedAt });
      const dataset = await repositories.datasets.findOrCreateForSource(sourceId, source.title ?? source.domain);
      version = await repositories.datasetVersions.allocate(dataset.id, sourceSnapshot.id);
      version = await repositories.datasetVersions.transition(version.id, "allocated", "normalizing");
      const parsed = parseSourceBytes({ sourceType: source.source_type, bytes: await readStream(await artifactStore.getStream(snapshot.rawObjectKey)), contentType: snapshot.contentType, url: snapshot.resolvedUrl });
      const normalized = normalizeRows(parsed.rows, { valueFields: parsed.schema.value_fields, normalizerVersion: parsed.parserVersion });
      const previous = await repositories.datasetVersions.latestBefore(dataset.id, version.version);
      const previousRows = previous?.normalized_object_key ? await readJsonl(await artifactStore.getStream(previous.normalized_object_key)) : null;
      const change = diffNormalizedRows(previousRows, normalized.rows);
      const normalizedKey = `normalized/${dataset.id}/v${version.version}/data.jsonl`;
      version = await repositories.datasetVersions.transition(version.id, "normalizing", "uploading");
      await artifactStore.putOnce({ key: normalizedKey, bytes: normalized.bytes, artifactHash: normalized.hash, contentType: "application/x-ndjson" });
      const coverageStart = normalized.rows[0].timestamp;
      const coverageEnd = normalized.rows.at(-1).timestamp;
      version = await repositories.datasetVersions.transition(version.id, "uploading", "stored", {
        normalized_object_key: normalizedKey,
        normalized_hash: Buffer.from(normalized.hash, "hex"),
        schema_profile: parsed.schema,
        quality_metrics: { ...normalized.quality, dropped: parsed.dropped },
        coverage_start: coverageStart,
        coverage_end: coverageEnd,
        frequency: normalized.quality.frequency,
        record_count: normalized.rows.length,
        missing_rate: normalized.quality.missing_rate,
        duplicate_rate: normalized.quality.duplicate_rate,
        outlier_rate: normalized.quality.outlier_rate,
        continuity: normalized.quality.continuity,
        normalizer_version: normalized.normalizerVersion,
      });
      const sealed = await repositories.datasetVersions.transition(version.id, "stored", "sealed", { sealed_at: new Date() });
      await pool.query(`UPDATE ingestion_runs SET status = 'completed', retrieved_at = $2, finished_at = now(), response_headers = $3, content_type = $4, content_length = $5, content_hash = $6, raw_object_key = $7, parser_name = $8, parser_version = $9, record_count = $10, change_type = $11 WHERE id = $1`, [run.id, snapshot.retrievedAt, snapshot.responseHeaders, snapshot.contentType, snapshot.contentLength, Buffer.from(snapshot.rawHash, "hex"), snapshot.rawObjectKey, parsed.parserName, parsed.parserVersion, normalized.rows.length, change.changeType]);
      await pool.query("UPDATE sources SET status = 'active', reliability = COALESCE(reliability, '{}'::jsonb) - 'consecutive_failures', last_successful_ingestion_at = now(), next_scrape_at = $2, updated_at = now() WHERE id = $1", [sourceId, nextScrapeAt()]);
      return { sourceId, ingestionRunId: run.id, datasetVersionId: sealed.id, version: sealed.version, changeType: change.changeType, normalizedHash: normalized.hash };
    } catch (error) {
      if (version) await repositories.datasetVersions.transition(version.id, version.status === "allocated" ? "allocated" : version.status, "failed").catch(() => {});
      await pool.query("UPDATE ingestion_runs SET status = 'failed', finished_at = now(), error_code = $2, error_detail = $3 WHERE id = $1", [run.id, "scrape_failed", String(error.message).slice(0, 1_000)]);
      await markSourceFailure(pool, sourceId);
      throw error;
    }
  };
}

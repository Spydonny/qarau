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

async function markSourceFailure(repositories, sourceId) {
  const failures = await repositories.sources.markFailure(sourceId, new Date(Date.now() + 60 * 60 * 1_000));
  await repositories.sources.updateById(sourceId, { next_scrape_at: retryAt(failures) });
  return failures;
}

/** Executes the full raw-capture → normalized immutable-version workflow. */
export function createScrapeSourceHandler({ db, artifactStore, sourceUrlKey = process.env.SOURCE_URL_ENCRYPTION_KEY, requestBytes }) {
  if (!db || !artifactStore) throw new Error("scrape_handler_dependencies_required");
  const repositories = createRepositories(db);
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
      await repositories.ingestionRuns.finish(run.id, { status: "completed", retrieved_at: snapshot.retrievedAt, finished_at: new Date(), response_headers: snapshot.responseHeaders, content_type: snapshot.contentType, content_length: snapshot.contentLength, content_hash: Buffer.from(snapshot.rawHash, "hex"), raw_object_key: snapshot.rawObjectKey, parser_name: parsed.parserName, parser_version: parsed.parserVersion, record_count: normalized.rows.length, change_type: change.changeType });
      await repositories.sources.markSuccess(sourceId, nextScrapeAt());
      return { sourceId, ingestionRunId: run.id, datasetVersionId: sealed.id, version: sealed.version, changeType: change.changeType, normalizedHash: normalized.hash };
    } catch (error) {
      if (version) await repositories.datasetVersions.transition(version.id, version.status === "allocated" ? "allocated" : version.status, "failed").catch(() => {});
      await repositories.ingestionRuns.markFailed(run.id, "scrape_failed", String(error.message).slice(0, 1_000));
      await markSourceFailure(repositories, sourceId);
      throw error;
    }
  };
}

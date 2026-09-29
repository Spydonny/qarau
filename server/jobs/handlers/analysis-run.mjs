import { createHash } from "node:crypto";
import { createRepositories } from "../../db/repositories/index.mjs";
import { HASH_DOMAINS, canonicalJsonBytes, canonicalJsonlBytes, hashBytes } from "../../domain/canonical-artifacts.mjs";
import { runQuantitativeAnalysis } from "../../analysis/quantitative.mjs";
import { analyzeSource } from "../../analyzers/index.mjs";

async function readStream(stream) { const chunks = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks); }
async function readJsonl(store, key) { return (await readStream(await store.getStream(key))).toString("utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
function rawHash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function safeResult(result, interpretation) {
  return {
    pipeline_version: result.pipelineVersion,
    signal_count: result.signalCount,
    evaluation_count: result.evaluationCount,
    best: result.best ? {
      field: result.best.signal.field,
      transformation: result.best.signal.transformation,
      window: result.best.signal.window,
      lag: result.best.lag,
      horizon: result.best.horizon,
      screening: result.best.screening,
      validation: result.best.validation,
      checks: result.best.checks,
      alpha: result.best.alpha,
    } : null,
    interpretation,
  };
}

/** Runs deterministic, durable quantitative analysis for one frozen dataset version. */
export function createAnalysisRunHandler({ db, artifactStore }) {
  if (!db || !artifactStore) throw new Error("analysis_handler_dependencies_required");
  const repositories = createRepositories(db);
  return async function analyze(job) {
    const analysisRun = await repositories.analysisRuns.findById(job.payload.analysisRunId);
    if (!analysisRun) throw new Error("analysis_run_not_found");
    // Queue delivery is at-least-once. If a worker finished durable writes but
    // lost its lease before acknowledging, acknowledge the already-final run
    // instead of recomputing or marking it as a false failure.
    if (["completed", "rejected"].includes(analysisRun.status)) {
      return { analysisRunId: analysisRun.id, status: analysisRun.status, alphaScore: Number(analysisRun.alpha_score ?? 0), alreadyProcessed: true };
    }
    if (analysisRun.status === "running") {
      const started = analysisRun.started_at ? Date.parse(analysisRun.started_at) : NaN;
      if (!Number.isFinite(started) || Date.now() - started < 15 * 60_000) throw new Error("analysis_run_not_queued");
      // Stale running (worker crash): same safe resume as failed.
    }
    if (analysisRun.status === "failed" || analysisRun.status === "running") {
      // Safe resume: drop partial candidates/results from the failed attempt so a retry is idempotent.
      await repositories.validationResults.deleteForAnalysis(analysisRun.id);
      await repositories.leakageChecks.deleteForAnalysis(analysisRun.id);
      await repositories.alphaScoreComponents.deleteForAnalysis(analysisRun.id);
      await repositories.screeningResults.deleteForAnalysis(analysisRun.id);
      await repositories.signalCandidates.deleteForAnalysis(analysisRun.id);
    } else if (analysisRun.status !== "queued") throw new Error("analysis_run_not_queued");
    const version = await repositories.datasetVersions.findById(analysisRun.dataset_version_id);
    const market = await repositories.marketSnapshots.findById(analysisRun.market_snapshot_id);
    if (!version || version.status !== "sealed" || !market) throw new Error("analysis_inputs_not_sealed");
    await repositories.analysisRuns.markRunning(analysisRun.id);
    try {
      const normalizedRows = await readJsonl(artifactStore, version.normalized_object_key);
      const marketRows = (await readJsonl(artifactStore, market.normalized_object_key)).map((row) => ({ timestamp: row.timestamp, price: row.price ?? row.values?.price }));
      const result = runQuantitativeAnalysis({ normalizedRows, marketRows, quality: version.quality_metrics });
      const dataset = await repositories.datasets.findById(version.dataset_id);
      const source = (dataset?.source_id ? await repositories.sources.findById(dataset.source_id) : null) ?? {};
      const interpretation = await analyzeSource({
        private: { summary: source.description ?? source.title ?? "Physical-world dataset" },
        measurementDescription: source.description ?? source.title ?? "Physical-world dataset",
        category: source.reliability?.category ?? "Other",
        region: source.reliability?.region ?? "Unspecified",
        sourceType: source.source_type ?? "unknown",
        temporalResolution: source.expected_update_interval ?? "unknown",
        updateFrequency: source.expected_update_interval ?? "unknown",
        latency: "unknown",
        historicalDepth: 0,
        historicalDataAvailable: true,
        sensitivityMode: "PRIVATE_SOURCE",
      });
      const manifest = {
        analysis_id: analysisRun.id,
        dataset_version_id: version.id,
        dataset_normalized_hash: Buffer.from(version.normalized_hash).toString("hex"),
        market_snapshot_id: market.id,
        market_normalized_hash: Buffer.from(market.normalized_hash).toString("hex"),
        mapping_id: analysisRun.mapping_id,
        pipeline_version: result.pipelineVersion,
        settings: result.settings,
      };
      const manifestBytes = canonicalJsonBytes(manifest);
      const report = safeResult(result, interpretation);
      const resultBytes = Buffer.from(JSON.stringify(report), "utf8");
      const manifestHash = hashBytes(HASH_DOMAINS.analysisManifest, manifestBytes);
      const resultHash = hashBytes(HASH_DOMAINS.analysisResult, resultBytes);
      const manifestKey = `analysis/${analysisRun.id}/manifest.json`;
      const resultKey = `analysis/${analysisRun.id}/results.json`;
      await artifactStore.putOnce({ key: manifestKey, bytes: manifestBytes, artifactHash: manifestHash, contentType: "application/json" });
      await artifactStore.putOnce({ key: resultKey, bytes: resultBytes, artifactHash: resultHash, contentType: "application/json" });
      for (const evaluation of result.evaluations) {
        const signalBytes = canonicalJsonlBytes(evaluation.signal.rows.map((row) => ({ available_at: row.availableAt, available_at_inferred: Boolean(row.availableAtInferred), timestamp: row.timestamp, values: { value: String(row.value) } })));
        const signalKey = `analysis/${analysisRun.id}/signals/${evaluation.signal.semanticFingerprint}.jsonl`;
        await artifactStore.putOnce({ key: signalKey, bytes: signalBytes, artifactHash: rawHash(signalBytes), contentType: "application/x-ndjson" });
        const existing = await repositories.signalCandidates.findByFingerprint(analysisRun.id, Buffer.from(rawHash(Buffer.from(JSON.stringify({ fingerprint: evaluation.signal.semanticFingerprint, lag: evaluation.lag, horizon: evaluation.horizon }))), "hex"));
        const candidate = existing ?? await repositories.signalCandidates.create({
          analysis_run_id: analysisRun.id,
          source_column: evaluation.signal.field,
          transformation: evaluation.signal.transformation,
          window_size: evaluation.signal.window,
          lag: evaluation.lag,
          horizon: evaluation.horizon,
          artifact_object_key: signalKey,
          artifact_hash: Buffer.from(rawHash(signalBytes), "hex"),
          parameters: { pipeline_version: result.pipelineVersion, window: evaluation.signal.window },
          semantic_fingerprint: Buffer.from(rawHash(Buffer.from(JSON.stringify({ fingerprint: evaluation.signal.semanticFingerprint, lag: evaluation.lag, horizon: evaluation.horizon }))), "hex"),
        });
        await repositories.screeningResults.create({ signal_candidate_id: candidate.id, target_id: market.target_id, horizon: evaluation.horizon, ...evaluation.screening });
        for (const check of evaluation.checks) await repositories.leakageChecks.create({ analysis_run_id: analysisRun.id, signal_candidate_id: candidate.id, check_type: check.check_type, status: check.status, metrics: {}, score_penalty: check.score_penalty, explanation: check.explanation });
        for (const item of [...(evaluation.validation?.splits ?? []), ...(evaluation.validation?.regimes ?? [])]) {
          const { split, regime_name = null, information_coefficient, directional_accuracy, return_spread, sharpe_like, max_drawdown, observations, trades, stability, sign, ...metrics } = item;
          await repositories.validationResults.create({ analysis_run_id: analysisRun.id, signal_candidate_id: candidate.id, split, regime_name, information_coefficient, directional_accuracy, return_spread, sharpe_like, max_drawdown, observations, trades, stability, sign, metrics });
        }
      }
      if (result.best) for (const component of result.best.alpha.components) await repositories.alphaScoreComponents.create({ analysis_run_id: analysisRun.id, ...component });
      const completed = Boolean(result.best);
      let bestCandidateId = null;
      let bestArtifactHash = null;
      if (result.best) {
        const fp = Buffer.from(rawHash(Buffer.from(JSON.stringify({ fingerprint: result.best.signal.semanticFingerprint, lag: result.best.lag, horizon: result.best.horizon }))), "hex");
        const found = await repositories.signalCandidates.findByFingerprint(analysisRun.id, fp);
        bestCandidateId = found?.id ?? null;
        bestArtifactHash = found?.artifact_hash ?? null;
      }
      await repositories.analysisRuns.markFinished(analysisRun.id, { status: completed ? "completed" : "rejected", manifest_object_key: manifestKey, manifest_hash: Buffer.from(manifestHash, "hex"), result_object_key: resultKey, result_hash: Buffer.from(resultHash, "hex"), report_object_key: resultKey, completed_at: new Date(), alpha_score: result.best?.alpha.score ?? 0, score_version: "quantitative-v2", blocking_leakage: result.best?.alpha.blocking ?? true, best_signal_candidate_id: bestCandidateId, best_artifact_hash: bestArtifactHash });
      return { analysisRunId: analysisRun.id, status: completed ? "completed" : "rejected", alphaScore: result.best?.alpha.score ?? 0, signalCount: result.signalCount, evaluationCount: result.evaluationCount };
    } catch (error) {
      await repositories.analysisRuns.markFailed(analysisRun.id, String(error.message).slice(0, 128));
      throw error;
    }
  };
}

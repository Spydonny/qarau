import { createHash } from "node:crypto";
import { createRepositories } from "../../db/repositories/index.mjs";
import { HASH_DOMAINS, canonicalJsonBytes, canonicalJsonlBytes, hashBytes } from "../../domain/canonical-artifacts.mjs";
import { runQuantitativeAnalysis } from "../../analysis/quantitative.mjs";

async function readStream(stream) { const chunks = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks); }
async function readJsonl(store, key) { return (await readStream(await store.getStream(key))).toString("utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
function rawHash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function safeResult(result) {
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
  };
}

/** Runs deterministic, durable quantitative analysis for one frozen dataset version. */
export function createAnalysisRunHandler({ pool, artifactStore }) {
  if (!pool || !artifactStore) throw new Error("analysis_handler_dependencies_required");
  const repositories = createRepositories(pool);
  return async function analyze(job) {
    const analysisRun = await repositories.analysisRuns.findById(job.payload.analysisRunId);
    if (!analysisRun) throw new Error("analysis_run_not_found");
    // Queue delivery is at-least-once. If a worker finished durable writes but
    // lost its lease before acknowledging, acknowledge the already-final run
    // instead of recomputing or marking it as a false failure.
    if (["completed", "rejected"].includes(analysisRun.status)) {
      return { analysisRunId: analysisRun.id, status: analysisRun.status, alphaScore: Number(analysisRun.alpha_score ?? 0), alreadyProcessed: true };
    }
    if (analysisRun.status !== "queued") throw new Error("analysis_run_not_queued");
    const version = await repositories.datasetVersions.findById(analysisRun.dataset_version_id);
    const market = await repositories.marketSnapshots.findById(analysisRun.market_snapshot_id);
    if (!version || version.status !== "sealed" || !market) throw new Error("analysis_inputs_not_sealed");
    await pool.query("UPDATE analysis_runs SET status = 'running', started_at = now(), error_code = NULL WHERE id = $1 AND status = 'queued'", [analysisRun.id]);
    try {
      const normalizedRows = await readJsonl(artifactStore, version.normalized_object_key);
      const marketRows = (await readJsonl(artifactStore, market.normalized_object_key)).map((row) => ({ timestamp: row.timestamp, price: row.price ?? row.values?.price }));
      const result = runQuantitativeAnalysis({ normalizedRows, marketRows, quality: version.quality_metrics });
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
      const report = safeResult(result);
      const resultBytes = Buffer.from(JSON.stringify(report), "utf8");
      const manifestHash = hashBytes(HASH_DOMAINS.analysisManifest, manifestBytes);
      const resultHash = hashBytes(HASH_DOMAINS.analysisResult, resultBytes);
      const manifestKey = `analysis/${analysisRun.id}/manifest.json`;
      const resultKey = `analysis/${analysisRun.id}/results.json`;
      await artifactStore.putOnce({ key: manifestKey, bytes: manifestBytes, artifactHash: manifestHash, contentType: "application/json" });
      await artifactStore.putOnce({ key: resultKey, bytes: resultBytes, artifactHash: resultHash, contentType: "application/json" });
      for (const evaluation of result.evaluations) {
        const signalBytes = canonicalJsonlBytes(evaluation.signal.rows.map((row) => ({ available_at: row.availableAt, timestamp: row.timestamp, values: { value: String(row.value) } })));
        const signalKey = `analysis/${analysisRun.id}/signals/${evaluation.signal.semanticFingerprint}.jsonl`;
        await artifactStore.putOnce({ key: signalKey, bytes: signalBytes, artifactHash: rawHash(signalBytes), contentType: "application/x-ndjson" });
        const candidate = await repositories.signalCandidates.create({
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
      await pool.query(`UPDATE analysis_runs SET status = $2::analysis_status, manifest_object_key = $3, manifest_hash = $4, result_object_key = $5, result_hash = $6, report_object_key = $5, completed_at = now(), alpha_score = $7, score_version = 'quantitative-v1', blocking_leakage = $8 WHERE id = $1`, [analysisRun.id, completed ? "completed" : "rejected", manifestKey, Buffer.from(manifestHash, "hex"), resultKey, Buffer.from(resultHash, "hex"), result.best?.alpha.score ?? 0, result.best?.alpha.blocking ?? true]);
      return { analysisRunId: analysisRun.id, status: completed ? "completed" : "rejected", alphaScore: result.best?.alpha.score ?? 0, signalCount: result.signalCount, evaluationCount: result.evaluationCount };
    } catch (error) {
      await pool.query("UPDATE analysis_runs SET status = 'failed', completed_at = now(), error_code = $2 WHERE id = $1", [analysisRun.id, String(error.message).slice(0, 128)]);
      throw error;
    }
  };
}

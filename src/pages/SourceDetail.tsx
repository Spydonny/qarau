import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { QarauOptions, QarauSourceDetail } from "../api/types";
import { SysMeta } from "../components/primitives";

export function SourceDetail() {
  const { id = "" } = useParams();
  const [data, setData] = useState<QarauSourceDetail | null>(null);
  const [options, setOptions] = useState<QarauOptions | null>(null);
  const [target, setTarget] = useState("EURUSD");
  const [equitySymbol, setEquitySymbol] = useState("");
  const [lag, setLag] = useState(10);
  const [horizon, setHorizon] = useState(1);
  const [targetCsv, setTargetCsv] = useState("");
  const [json, setJson] = useState({ url: "", timestampField: "timestamp", valueField: "value", availableAtField: "available_at" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [schedule, setSchedule] = useState<{ cadenceMinutes: number; nextEpochAt: string; queued: number; immediateMode: boolean } | null>(null);

  const reload = useCallback(() => Promise.all([api.source(id), api.commitmentSchedule()]).then(([result, nextSchedule]) => { setData(result); setSchedule(nextSchedule); setJson((current) => ({ ...current, url: current.url || result.privateMetadata.url })); }).catch(() => setError("Source could not be opened.")), [id]);
  useEffect(() => { reload(); api.qarauOptions().then(setOptions).catch(() => setError("Target options could not be loaded.")); }, [reload]);
  const act = async (label: string, operation: () => Promise<unknown>) => { setBusy(label); setError(""); try { await operation(); await reload(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Operation failed."); } finally { setBusy(""); } };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) await act("Uploading", async () => api.ingestDataset(id, await file.text())); };
  const uploadTarget = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) setTargetCsv(await file.text()); };

  if (!data) return <div className="shell page"><p className="meta">Opening source record</p></div>;
  const { source, analysis, tests, commitments, claims, accessReceipts } = data;
  const availableTargets = options?.targets ?? [];
  const latestClaim = claims[0];
  const externalAiBlocked = options?.analyzer.provider === "openai-compatible" && source.sensitivityMode !== "PUBLIC_SOURCE";
  return (
    <div className="shell page">
      <div className="data-head">
        <div><Link to="/data" className="btn-ghost">Back to data <span className="arrow">→</span></Link><h1 className="h1" style={{ marginTop: 26 }}>{source.name}</h1><p className="body" style={{ marginTop: 16 }}>{source.provider} · {source.category} · {source.region} · {source.status}</p></div>
        <SysMeta rows={[["SOURCE", source.publicId.slice(-8)], ["CANDIDATE", String(source.scores.candidate)], ["PROVENANCE", source.commitmentStatus]]} />
      </div>

      <section className="source-section">
        <p className="meta">Source overview</p>
        <p className="body-sm" style={{ marginTop: 14 }}>{source.measurementDescription}</p><div className="source-facts overview-grid"><span>Type: {source.sourceType}</span><span>Industry: {source.industry}</span><span>Spatial: {source.spatialResolution}</span><span>Temporal: {source.temporalResolution}</span><span>Update: {source.updateFrequency}</span><span>Latency: {source.latency}</span><span>History: {source.historicalDepth || "Unknown"}Y</span><span>Access: {source.accessType}</span><span>Pricing: {source.pricingType}</span><span>Formats: {source.dataFormats.join(", ") || "Unknown"}</span><span>License: {source.licenseSummary}</span><span>API: {source.apiAvailable ? "Available" : "No"}</span><span>Sensitivity: {source.sensitivityMode}</span><span>Provider claim: {source.verificationStatus}</span></div>
        <div className="source-score-grid"><span>Quality<strong>{source.scores.quality}</strong></span><span>Economic relevance<strong>{source.scores.economicRelevance}</strong></span><span>Novelty<strong>{source.scores.novelty}</strong></span><span>Testability<strong>{source.scores.testability}</strong></span><span>Candidate<strong>{source.scores.candidate}</strong></span></div>
      </section>

      <section className="cfg source-tools">
        <div><p className="meta">Private source metadata</p><p className="body-sm" style={{ marginTop: 12 }}>{data.privateMetadata.summary || "No sanitized source summary yet."}</p></div>
        <div className="source-actions"><button className="btn btn-secondary" onClick={() => act("Parsing", () => api.parseSource(id))} disabled={Boolean(busy)}>{busy === "Parsing" ? "Parsing" : "Parse source"}</button><button className="btn btn-primary" onClick={() => act("Analyzing", () => api.analyzeSource(id))} disabled={Boolean(busy) || externalAiBlocked}>{busy === "Analyzing" ? "Analyzing" : `Run ${options?.analyzer.provider === "openai-compatible" ? "external" : "local"} AI analysis`}</button>{externalAiBlocked && <span className="meta gate-error">External AI disabled for this sensitivity mode</span>}</div>
      </section>

      {analysis && <section className="source-section"><p className="meta">Hypothesis generation · {analysis.disclosure} · confidence {(analysis.confidence * 100).toFixed(0)}%</p><p className="body" style={{ marginTop: 14 }}>{analysis.causalHypotheses[0]}</p><div className="analysis-grid"><div><span className="meta">What it measures</span><p>{analysis.phenomenon}</p></div><div><span className="meta">Economic channel</span><p>{analysis.potentialCausalChain.join(" → ")}</p></div><div><span className="meta">Candidate markets</span><p>{analysis.assetClasses.join(", ")} · {analysis.candidateTargets.join(", ")}</p></div><div><span className="meta">Potential lag</span><p>{analysis.suggestedLagRange.join("-")} days</p></div><div><span className="meta">Confounders</span><p>{analysis.confounders.join(", ")}</p></div><div><span className="meta">Data and leakage risks</span><p>{analysis.leakageRisks.join(", ")}</p></div><div><span className="meta">Possible information advantage</span><p>{analysis.informationAdvantage}</p></div><div><span className="meta">Additional validation data</span><p>{analysis.additionalDataRequired.join(", ")}</p></div></div><p className="meta" style={{ marginTop: 16 }}>{analysis.conclusion}</p></section>}

      <section className="source-section"><p className="meta">Provider ownership · private verification</p><p className="body-sm" style={{ marginTop: 12 }}>Verification is retained privately and is never linked to the source in the public Merkle-root transaction.</p><div className="source-actions" style={{ marginTop: 18 }}>{(!latestClaim || latestClaim.status === "REJECTED") && <button className="btn btn-secondary" onClick={() => act("Starting verification", () => api.beginClaim(id, "ADMIN_REVIEW"))} disabled={Boolean(busy)}>Start admin verification</button>}{latestClaim?.status === "PENDING_VERIFICATION" && <><span className="meta">Challenge / {latestClaim.challenge}</span><button className="btn btn-primary" onClick={() => act("Approving", () => api.decideClaim(id, latestClaim.id, "VERIFIED"))} disabled={Boolean(busy)}>Approve verified control</button><button className="btn btn-secondary" onClick={() => act("Rejecting", () => api.decideClaim(id, latestClaim.id, "REJECTED"))} disabled={Boolean(busy)}>Reject</button></>}{latestClaim?.status === "VERIFIED" && <span className="meta">Verified off-chain / {new Date(latestClaim.verifiedAt || latestClaim.createdAt).toLocaleString()}</span>}<button className="btn btn-secondary" onClick={() => act("Recording access", () => api.recordAccessReceipt(id, "INTERNAL_RESEARCH"))} disabled={Boolean(busy)}>Record private access receipt</button></div>{accessReceipts[0] && <p className="meta" style={{ marginTop: 12 }}>Latest receipt / {accessReceipts[0].hash.slice(0, 16)} · {accessReceipts[0].status}</p>}</section>

      <section className="source-section">
        <p className="meta">Dataset connection · immutable snapshots</p>
        <p className="body-sm" style={{ marginTop: 12 }}>{source.dataset ? `${source.dataset.rows} real rows from ${source.dataset.provider}; retrieved ${new Date(source.dataset.retrievedAt).toLocaleString()}. Snapshot ${source.dataset.snapshotId.slice(-8)}.` : "Connect the configured provider, upload CSV, or map a JSON time-series API. No synthetic fallback is used."}</p>
        <div className="source-actions" style={{ marginTop: 20 }}><button className="btn btn-primary" onClick={() => act("Connecting", () => api.connectSource(id))} disabled={Boolean(busy)}>{busy === "Connecting" ? "Connecting" : "Connect provider"}</button><label className="btn btn-secondary">Upload source CSV<input type="file" accept=".csv,text/csv" onChange={upload} hidden /></label></div>
        <div className="json-connector"><input className="source-input" value={json.url} onChange={(event) => setJson({ ...json, url: event.target.value })} placeholder="JSON API URL" /><input className="source-input" value={json.timestampField} onChange={(event) => setJson({ ...json, timestampField: event.target.value })} placeholder="Timestamp field" /><input className="source-input" value={json.valueField} onChange={(event) => setJson({ ...json, valueField: event.target.value })} placeholder="Value field" /><input className="source-input" value={json.availableAtField} onChange={(event) => setJson({ ...json, availableAtField: event.target.value })} placeholder="Available-at field (optional)" /><button className="btn btn-secondary" onClick={() => act("Connecting JSON", () => api.ingestJsonDataset(id, json))} disabled={!json.url || Boolean(busy)}>Connect JSON API</button></div>
        {source.dataset?.quality.warnings.length ? <p className="meta gate-error" style={{ marginTop: 14 }}>{source.dataset.quality.warnings.join(" · ")}</p> : null}
      </section>

      <section className="source-section">
        <p className="meta">Alpha Lab · real market data</p>
        <div className="target-controls">
          <label className="filter-field"><span className="meta">Target</span><select className="source-input" value={target} onChange={(event) => { setTarget(event.target.value); setTargetCsv(""); }}>{availableTargets.map((item) => <option key={item.symbol} value={item.symbol} disabled={!item.configured}>{item.name} · {item.provider}{item.configured ? "" : " · key required"}</option>)}</select></label>
          {target === "CUSTOM_EQUITY" && <label className="filter-field"><span className="meta">Equity symbol</span><input className="source-input" value={equitySymbol} onChange={(event) => setEquitySymbol(event.target.value.toUpperCase())} placeholder="Ticker" /></label>}
          <label className="filter-field"><span className="meta">Maximum lag</span><input className="source-input" type="number" min="0" max="30" value={lag} onChange={(event) => setLag(Number(event.target.value))} /></label>
          <label className="filter-field"><span className="meta">Prediction horizon</span><input className="source-input" type="number" min="1" max="20" value={horizon} onChange={(event) => setHorizon(Number(event.target.value))} /></label>
          <label className="btn btn-secondary">{targetCsv ? "Target CSV attached" : "Upload target CSV"}<input type="file" accept=".csv,text/csv" onChange={uploadTarget} hidden /></label>
          <button className="btn btn-primary" onClick={() => act("Testing", () => api.alphaTest(id, { target, lag, horizon, equitySymbol, targetCsv: targetCsv || undefined }))} disabled={!source.dataset || Boolean(busy)}>{busy === "Testing" ? "Testing" : "Run Alpha Test"}</button>
        </div>
        {tests[0] && <div className="source-test"><p className="body">Evidence {tests[0].evidenceScore}/100 · best lag {tests[0].bestLag}D · OOS delta R² {tests[0].deltaR2.toFixed(3)}</p><div className="source-facts"><span>Samples: {tests[0].sampleSize}</span><span>Spearman: {(tests[0].correlationByLag.find((item) => item.lag === tests[0].bestLag)?.spearman ?? 0).toFixed(3)}</span><span>Mutual information: {tests[0].mutualInformation.toFixed(3)}</span><span>Fold stability: {(tests[0].stabilityAcrossFolds * 100).toFixed(0)}%</span></div><p className="meta" style={{ marginTop: 10 }}>{tests[0].warnings.length ? tests[0].warnings.join(" · ") : "No automatic warnings"}</p><button className="btn-ghost" style={{ marginTop: 16 }} onClick={() => act("Queueing", () => api.commitTest(tests[0].id))} disabled={Boolean(busy)}>Queue analysis provenance <span className="arrow">→</span></button></div>}
      </section>

      <section className="source-section source-commit"><p className="meta">Solana Devnet provenance</p><p className="body-sm" style={{ marginTop: 12 }}>Only a fixed-cadence Merkle root may leave the private system. Raw URLs, targets, hypotheses, and results remain encrypted locally.</p>{schedule && <p className="meta" style={{ marginTop: 12 }}>Cadence / {schedule.cadenceMinutes} minutes · next epoch {new Date(schedule.nextEpochAt).toLocaleString()} · queued {schedule.queued}</p>}<div className="source-actions" style={{ marginTop: 20 }}><button className="btn btn-secondary" onClick={() => act("Queueing", () => api.commitSource(id))} disabled={Boolean(busy)}>{busy === "Queueing" ? "Queueing" : "Queue source commitment"}</button>{schedule?.immediateMode && <button className="btn btn-primary" onClick={() => act("Committing", () => api.commitEpoch())} disabled={Boolean(busy)}>{busy === "Committing" ? "Confirming on Devnet" : "Commit queued epoch now"}</button>}</div>{commitments.map((commitment) => <p key={commitment.id} className="meta" style={{ marginTop: 12 }}>{commitment.kind} · {commitment.status}{commitment.epoch ? ` · epoch ${commitment.epoch}` : ""}{commitment.signature ? <> · <a href={`https://explorer.solana.com/tx/${commitment.signature}?cluster=devnet`} target="_blank" rel="noreferrer">Solana verified</a></> : ""}</p>)}</section>
      {error && <p className="meta gate-error" style={{ marginTop: 20 }}>{error}</p>}
    </div>
  );
}

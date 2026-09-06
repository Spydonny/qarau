/* oxlint-disable react(set-state-in-effect) -- durable registry polling deliberately mirrors external state. */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { v1, type V1DatasetVersion, type V1Job, type V1Source } from "../api/client";
import type { RunLanes } from "../api/types";
import { FunnelTrace } from "../components/FunnelTrace";

const TERMINAL = new Set(["completed", "failed", "dead_letter"]);
const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const value = (record: Record<string, unknown>, key: string) => record[key] == null ? "—" : String(record[key]);

async function waitForJob(job: V1Job) {
  let current = job;
  const until = Date.now() + 120_000;
  while (!TERMINAL.has(current.status)) {
    if (Date.now() > until) throw new Error("job_wait_timeout");
    await sleep(1_000);
    current = (await v1.job(current.id)).job;
  }
  if (current.status !== "completed") throw new Error(current.error_code || current.error_detail || "job_failed");
  return current;
}

function SourceStatus({ source }: { source: V1Source }) {
  return <span className="meta">{source.status.toUpperCase()} · {source.source_type} · {source.last_successful_ingestion_at ? `last ingest ${new Date(source.last_successful_ingestion_at).toLocaleString()}` : "not ingested"}</span>;
}

/** Durable operator console. Every control below drives /api/v1 workers, not the legacy prototype routes. */
export function Pipeline() {
  const navigate = useNavigate();
  const [sources, setSources] = useState<V1Source[]>([]);
  const [funnel, setFunnel] = useState<RunLanes | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Loading durable source registry…");
  const reload = useCallback(async () => { const [sourceData, funnelData] = await Promise.all([v1.sources(), v1.funnel()]); setSources(sourceData.sources); setFunnel(funnelData); }, []);

  // This effect owns the durable registry polling lifecycle and mirrors server state into the console.
  // oxlint-disable-next-line react(set-state-in-effect)
  useEffect(() => { reload().then(() => setNotice("")).catch(() => setNotice("The durable registry is unavailable.")); }, [reload]);
  const discover = async () => {
    try {
      setBusy(true); setNotice("Discovery worker is querying the public catalog…");
      await waitForJob((await v1.discovery()).job);
      await reload(); setNotice("Discovery completed. New URLs were deduplicated and stored as candidates.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Discovery failed."); }
    finally { setBusy(false); }
  };

  return <div className="shell page">
    <div className="data-head">
      <div><h1 className="h1">Durable pipeline</h1><p className="body" style={{ marginTop: 16 }}>The production path: real discovery, immutable ingestion, quantitative validation, package sealing, and guarded Devnet publication.</p></div>
      <div className="sys-meta"><span className="meta">SOURCES / {sources.length}</span><span className="meta">WORKERS / ACTIVE</span></div>
    </div>
    <section className="register source-panel">
      <p className="meta">01 / Automated source discovery</p>
      <p className="body-sm" style={{ marginTop: 12 }}>Generates data-theme queries against a live public data catalog. Candidates are persisted by canonical URL hash; it is not a fixed URL list.</p>
      <div className="source-actions" style={{ marginTop: 18 }}><button className="btn btn-primary" onClick={discover} disabled={busy}>{busy ? "Running discovery…" : "Run discovery"}</button><button className="btn btn-secondary" onClick={() => reload().catch(() => setNotice("Refresh failed."))} disabled={busy}>Refresh registry</button></div>
      {notice && <p className="meta" style={{ marginTop: 14 }}>{notice}</p>}
    </section>
    <hr className="rule" />
    <section className="register source-panel"><div className="register-head"><p className="meta">02 / Production funnel</p><span className="meta">Real persisted records</span></div><FunnelTrace data={funnel} progress={1} selectedId={null} onSelect={(lane) => navigate(`/admin/pipeline/sources/${lane.id}`)} /></section>
    <hr className="rule" />
    <section className="register">
      <div className="register-head"><p className="meta">03 / Source registry</p><span className="meta">URLs remain encrypted at rest</span></div>
      <div className="source-list">
        {sources.map((source) => <Link key={source.id} to={`/admin/pipeline/sources/${source.id}`} className="source-row"><span><span className="mono">SRC / {source.id.slice(-8).toUpperCase()}</span><strong>{source.title || source.domain}</strong></span><span className="meta">{source.domain}</span><SourceStatus source={source} /><span className="arrow">→</span></Link>)}
        {!sources.length && <p className="body-sm empty-registry">No candidates yet. Run live discovery to create the first registry entries.</p>}
      </div>
    </section>
  </div>;
}

export function PipelineSource() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [source, setSource] = useState<V1Source | null>(null);
  const [versions, setVersions] = useState<V1DatasetVersion[]>([]);
  const [ingestions, setIngestions] = useState<Array<Record<string, unknown>>>([]);
  const [analyses, setAnalyses] = useState<Array<Record<string, unknown>>>([]);
  const [target, setTarget] = useState("BTC-USD");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const reload = useCallback(async () => {
    const data = await v1.source(id);
    setSource(data.source); setVersions(data.versions); setIngestions(data.ingestion_runs); setAnalyses(data.analysis_runs);
  }, [id]);
  useEffect(() => { const timer = window.setTimeout(() => { reload().catch((error) => setNotice(error instanceof Error ? error.message : "Source unavailable.")); }, 0); return () => window.clearTimeout(timer); }, [reload]);
  const act = async (name: string, operation: () => Promise<void>) => {
    try { setBusy(name); setNotice(""); await operation(); await reload(); setNotice(`${name} completed.`); }
    catch (error) { setNotice(error instanceof Error ? error.message : `${name} failed.`); }
    finally { setBusy(""); }
  };
  const newest = versions[0];
  if (!source) return <div className="shell page"><p className="meta">{notice || "Loading source…"}</p></div>;
  const screening = source.screening;
  return <div className="shell page">
    <Link className="btn-ghost" to="/admin/pipeline">← Durable pipeline</Link>
    <div className="page-head" style={{ marginTop: 28 }}><p className="meta">SOURCE / {source.id}</p><h1 className="h1">{source.title || source.domain}</h1><p className="body" style={{ marginTop: 12 }}>{source.description || "No publisher description was supplied."}</p><SourceStatus source={source} /></div>
    <section className="source-section"><p className="meta">03 / Ten-gate screening and licensing</p><p className="body-sm" style={{ marginTop: 12 }}>Screening runs from public metadata before ingestion. Passing it is necessary but not sufficient: an owner must separately record whether the reviewed license permits derived research or redistribution.</p><p className="meta" style={{ marginTop: 14 }}>SCREEN / {screening ? `${screening.score}/10 · ${screening.passed ? "PASS" : "REJECT"}` : "PENDING"}</p>{screening?.rejection_reasons?.length ? <p className="body-sm">{screening.rejection_reasons.join(" · ")}</p> : null}<div className="source-actions" style={{ marginTop: 18 }}>{source.status === "candidate" || source.status === "approved" ? <><button className="btn btn-secondary" disabled={Boolean(busy) || !screening?.passed} onClick={() => act("Derived-only approval", async () => { await v1.approve(source.id, { redistribution_rights: false, derivative_rights: true }); })}>Approve derived-only</button><button className="btn btn-secondary" disabled={Boolean(busy) || !screening?.passed} onClick={() => act("Redistribution approval", async () => { await v1.approve(source.id, { redistribution_rights: true, derivative_rights: true }); })}>Approve redistribution</button></> : null}<button className="btn btn-primary" disabled={Boolean(busy) || source.status !== "active"} onClick={() => act("Scrape", async () => { await waitForJob((await v1.scrape(source.id)).job); })}>{busy === "Scrape" ? "Scraping…" : "Fetch and normalize now"}</button></div></section>
    <section className="source-section"><p className="meta">Source history</p><div className="source-list" style={{ marginTop: 14 }}>{ingestions.map((run) => <div className="source-row" key={value(run, "id")}><span><span className="mono">RUN / {value(run, "id").slice(-8)}</span><strong>{value(run, "status")}</strong></span><span className="meta">{value(run, "change_type")} · {value(run, "record_count")} records</span><span className="meta">{value(run, "retrieved_at") === "—" ? "not retrieved" : new Date(value(run, "retrieved_at")).toLocaleString()}</span></div>)}{!ingestions.length && <p className="body-sm empty-registry">No ingestion has run for this source.</p>}</div></section>
    <section className="source-section"><p className="meta">04 / Versioned normalized datasets</p><div className="source-list" style={{ marginTop: 14 }}>{versions.map((version) => <div className="source-row" key={version.id}><span><span className="mono">VERSION / {version.version}</span><strong>{version.status}</strong></span><span className="meta">{version.record_count ?? "—"} observations · {version.frequency || "frequency pending"}</span><span className="meta">missing {Number(version.missing_rate ?? 0).toFixed(3)} · duplicates {Number(version.duplicate_rate ?? 0).toFixed(3)} · outliers {Number(version.outlier_rate ?? 0).toFixed(3)}</span></div>)}{!versions.length && <p className="body-sm empty-registry">A sealed normalized version appears here after a successful scrape.</p>}</div></section>
    <section className="source-section"><p className="meta">05 / Quantitative analysis</p><div className="target-controls" style={{ marginTop: 14 }}><label className="filter-field"><span className="meta">Market target</span><select className="source-input" value={target} onChange={(event) => setTarget(event.target.value)}><option>BTC-USD</option><option>ETH-USD</option><option>EURUSD</option><option>EURGBP</option></select></label><button className="btn btn-primary" disabled={Boolean(busy) || !newest || newest.status !== "sealed"} onClick={() => act("Analysis", async () => { const created = await v1.startAnalysis(newest.id, target); navigate(`/admin/pipeline/analysis/${created.analysis_run.id}`); })}>{busy === "Analysis" ? "Starting…" : "Run chronological validation"}</button></div><div className="source-list" style={{ marginTop: 14 }}>{analyses.map((run) => <Link className="source-row" key={value(run, "id")} to={`/admin/pipeline/analysis/${value(run, "id")}`}><span><span className="mono">ANALYSIS / {value(run, "id").slice(-8)}</span><strong>{value(run, "status")}</strong></span><span className="meta">Alpha score {value(run, "alpha_score")}</span><span className="meta">blocking leakage {value(run, "blocking_leakage")}</span><span className="arrow">→</span></Link>)}</div></section>
    {notice && <p className="meta gate-error" style={{ marginTop: 20 }}>{notice}</p>}
  </div>;
}

export function PipelineAnalysis() {
  const { id = "" } = useParams();
  const [data, setData] = useState<Awaited<ReturnType<typeof v1.analysis>> | null>(null);
  const [title, setTitle] = useState("Validated QARAU dataset");
  const [seats, setSeats] = useState(3);
  const [offset, setOffset] = useState(0);
  const [notice, setNotice] = useState("Loading analysis…");
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => { const next = await v1.analysis(id, offset); setData(next); setNotice(""); }, [id, offset]);
  useEffect(() => { const timer = window.setTimeout(() => { reload().catch((error) => setNotice(error instanceof Error ? error.message : "Analysis unavailable.")); }, 0); return () => window.clearTimeout(timer); }, [reload]);
  useEffect(() => {
    const status = String(data?.analysis_run.status ?? "");
    if (["queued", "running"].includes(status)) { const timer = window.setInterval(() => { reload().catch(() => undefined); }, 2_000); return () => window.clearInterval(timer); }
  }, [data?.analysis_run.status, reload]);
  const packageId = data?.package?.id ?? "";
  const packageStatus = data?.package?.status ?? "";
  const run = data?.analysis_run;
  const createPackage = async () => { try { setBusy(true); const created = await v1.createPackage(id, title, seats); await reload(); setNotice(created.existing ? "This analysis already has a sealed package; its state was restored." : "Package sealed. It remains private until you explicitly publish it to Devnet."); } catch (error) { setNotice(error instanceof Error ? error.message : "Package sealing failed."); } finally { setBusy(false); } };
  const publish = async () => { try { setBusy(true); const job = await v1.publishPackage(packageId, { max_winners: seats }); setNotice(`Devnet access round queued as ${job.job.id}. The isolated signer will only mark it committed after finalization.`); } catch (error) { setNotice(error instanceof Error ? error.message : "Publication request failed."); } finally { setBusy(false); } };
  if (!data || !run) return <div className="shell page"><p className="meta">{notice}</p></div>;
  const complete = run.status === "completed" && !run.blocking_leakage;
  return <div className="shell page">
    <Link className="btn-ghost" to="/admin/pipeline">← Durable pipeline</Link>
    <div className="page-head" style={{ marginTop: 28 }}><p className="meta">ANALYSIS / {id}</p><h1 className="h1">Chronological validation</h1><p className="body" style={{ marginTop: 12 }}>Status: {String(run.status)} · Alpha score: {value(run, "alpha_score")} · pipeline {value(run, "pipeline_version")}</p></div>
    <section className="source-section"><p className="meta">Data quality and deterministic alpha score</p><div className="analysis-grid" style={{ marginTop: 16 }}>{data.alpha_score_components.map((part) => <div key={value(part, "component")}><span className="meta">{value(part, "component")}</span><p>{Number(part.normalized_score ?? 0).toFixed(1)} / 100</p><p className="meta">{value(part, "explanation")}</p></div>)}</div></section>
    <section className="source-section"><p className="meta">Leakage and bias controls</p><div className="source-list" style={{ marginTop: 14 }}>{data.leakage_checks.map((check) => <div className="source-row" key={`${value(check, "check_type")}-${value(check, "status")}`}><span><span className="mono">{value(check, "check_type")}</span><strong>{value(check, "status")}</strong></span><span className="meta">{value(check, "count")} checks · total penalty {value(check, "score_penalty")}</span><span className="meta">{value(check, "explanation")}</span></div>)}</div></section>
    <section className="source-section"><p className="meta">Candidate signals and out-of-sample validation</p><div className="source-list" style={{ marginTop: 14 }}>{data.signal_candidates.map((signal) => <div className="source-row" key={value(signal, "id")}><span><span className="mono">{value(signal, "transformation")}</span><strong>{value(signal, "source_column")}</strong></span><span className="meta">lag {value(signal, "lag")} · horizon {value(signal, "horizon")}</span><span className="meta">{data.validations.filter((item) => item.signal_candidate_id === signal.id).map((item) => `test IC ${Number(item.information_coefficient ?? 0).toFixed(3)}, Sharpe ${Number(item.sharpe_like ?? 0).toFixed(2)}`).join(" · ") || "validation pending"}</span></div>)}</div><div className="pagination"><button className="btn btn-secondary" disabled={!data.pagination.has_previous} onClick={() => setOffset(Math.max(0, offset - data.pagination.limit))}>Previous</button><span className="mono">{data.pagination.total ? `${data.pagination.offset + 1}–${Math.min(data.pagination.offset + data.signal_candidates.length, data.pagination.total)} / ${data.pagination.total}` : "No candidates"}</span><button className="btn btn-secondary" disabled={!data.pagination.has_next} onClick={() => setOffset(offset + data.pagination.limit)}>Next</button></div></section>
    <section className="source-section"><p className="meta">06 / Private package and on-chain access round</p><p className="body-sm" style={{ marginTop: 12 }}>Package sealing writes immutable policy and private metadata. Publication is a separate explicit Devnet action; it creates the DatasetCommitment and a transparent Top-N pay-as-bid access round.</p>{packageId ? <p className="meta" style={{ marginTop: 14 }}>PACKAGE / {packageId} · {packageStatus.toUpperCase()}</p> : <div className="target-controls" style={{ marginTop: 16 }}><input className="source-input" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Package title" /><input className="source-input" type="number" min="1" max="10" value={seats} onChange={(event) => setSeats(Number(event.target.value))} aria-label="Maximum winners" /><button className="btn btn-secondary" disabled={!complete || busy} onClick={createPackage}>Seal package</button></div>}{packageId && ["sealed", "publication_failed", "committed"].includes(packageStatus) && <div className="target-controls" style={{ marginTop: 16 }}><button className="btn btn-primary" disabled={busy} onClick={publish}>{packageStatus === "publication_failed" ? "Retry Devnet publication" : "Publish access round to Devnet"}</button></div>}{!complete && <p className="meta gate-error" style={{ marginTop: 12 }}>Package creation stays disabled until the analysis is completed without blocking leakage.</p>}</section>
    {notice && <p className="meta gate-error" style={{ marginTop: 20 }}>{notice}</p>}
  </div>;
}

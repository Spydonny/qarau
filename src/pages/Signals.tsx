import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { InventoryStats, SignalStatus, SignalSummary } from "../api/types";
import { SysMeta } from "../components/primitives";
import { StatusMark, Verdict } from "../components/health";

const FILTERS: (SignalStatus | "ALL")[] = ["ALL", "ACTIVE", "WATCHLIST", "CANDIDATE"];

export function Signals() {
  const [data, setData] = useState<{ stats: InventoryStats; signals: SignalSummary[] } | null>(null);
  const [filter, setFilter] = useState<SignalStatus | "ALL">("ALL");
  const [error, setError] = useState(false);
  useEffect(() => { api.signals().then(setData).catch(() => setError(true)); }, []);
  if (error) return <div className="shell page"><p className="meta">Could not load research evidence.</p></div>;
  if (!data) return <div className="shell page"><p className="meta">Loading research evidence</p></div>;
  const shown = data.signals.filter((signal) => filter === "ALL" || signal.status === filter);
  return (
    <div className="shell page">
      <div className="data-head"><div><h1 className="h1">Research evidence</h1><p className="body" style={{ marginTop: 16 }}>Private out-of-sample results from real source and target snapshots. Evidence is not a profitability claim.</p></div><SysMeta rows={[["ACCESS", "OWNER"], ["VISIBILITY", "INTERNAL"], ["TESTS", String(data.stats.total)]]} /></div>
      <div className="inv-stats">{([[data.stats.active, "Strong evidence"], [data.stats.watchlist, "Watchlist"], [data.stats.candidate, "Candidate"], [data.stats.rejected, "Rejected"]] as [number, string][]).map(([value, label]) => <div key={label} className="inv-stat"><p className="metric-sm mono">{String(value).padStart(2, "0")}</p><p className="meta">{label}</p></div>)}</div>
      <div className="register-head"><p className="meta">Filter</p><div className="filters">{FILTERS.map((item) => <button key={item} className={`filter ${filter === item ? "is-active" : ""}`} onClick={() => setFilter(item)}>{item}</button>)}</div></div>
      <div className="sig-list">
        {shown.map((signal) => <article key={signal.id} className="sigrow"><div className="sigrow-id"><p className="mono sigrow-sig">TEST / {signal.id.slice(-8)}</p><StatusMark status={signal.status} /></div><div className="sigrow-main"><h2 className="sigrow-name">{signal.name} <span className="arrow-to">→</span> <span className="mono">{signal.target}</span></h2><p className="meta" style={{ marginTop: 12 }}>{signal.sampleSize} leakage-safe observations · lag {signal.bestLag}D</p></div><dl className="sigrow-metrics"><div><dt className="meta">Out of sample</dt><dd className="mono"><Verdict passed={signal.oosPassed}>{signal.oosPassed ? "Improved" : "Not improved"}</Verdict></dd></div><div><dt className="meta">R² baseline → augmented</dt><dd className="mono">{signal.baselineR2.toFixed(3)} → {signal.augmentedR2.toFixed(3)}</dd></div><div><dt className="meta">Evidence</dt><dd className="mono">{signal.evidenceScore}/100</dd></div><div><dt className="meta">Fold stability</dt><dd className="mono">{signal.stability.toFixed(0)}%</dd></div></dl><div className="sigrow-health"><p className="meta">{signal.warnings.length ? signal.warnings.join(" · ") : "No automatic warnings"}</p></div><div className="sigrow-go"><Link to={`/signals/${signal.id}`} className="btn-ghost">Open evidence <span className="arrow">→</span></Link></div></article>)}
        {!shown.length && <p className="body-sm empty-registry">No real Alpha Tests in this view. Connect a source and run a test from its source record.</p>}
      </div>
      <p className="meta muted" style={{ marginTop: 40, lineHeight: 1.8 }}>Every row references immutable source and target snapshots. No simulated results are shown.</p>
    </div>
  );
}

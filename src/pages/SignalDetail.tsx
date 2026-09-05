import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { SignalDetail as Detail } from "../api/types";
import { SysMeta } from "../components/primitives";
import { Verdict } from "../components/health";

export function SignalDetail() {
  const { id = "" } = useParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { api.signal(id).then(setDetail).catch(() => setMissing(true)); }, [id]);
  if (missing) return <div className="shell page"><h1 className="h1">No such test</h1><Link to="/signals" className="btn-ghost" style={{ marginTop: 24 }}>Back to evidence <span className="arrow">→</span></Link></div>;
  if (!detail) return <div className="shell page"><p className="meta">Opening evidence record</p></div>;
  const { test, source, analysis } = detail;
  const best = test.correlationByLag.find((item) => item.lag === test.bestLag);
  const passed = test.deltaR2 > 0 && test.folds.filter((fold) => fold.deltaR2 > 0).length >= 2;
  return (
    <div className="shell page">
      <Link to="/signals" className="btn-ghost">Back to evidence <span className="arrow">→</span></Link>
      <header className="sd-head"><div className="sd-id"><p className="mono sd-sig">TEST / {test.id.slice(-8)}</p><span className="proprietary">Private</span></div><h1 className="display-sm sd-title">{source.name}<span className="sd-arrow">→</span><span className="sd-target">{test.target}</span></h1><SysMeta inline rows={[["SOURCE SNAPSHOT", test.sourceSnapshotId?.slice(-8) || "—"], ["TARGET SNAPSHOT", test.targetSnapshotId?.slice(-8) || "—"], ["TARGET PROVIDER", test.targetProvider || "—"], ["CREATED", test.createdAt || "—"]]} /></header>
      <section className="sd-block"><p className="meta sd-q">A — Hypothesis</p><p className="sd-thesis">{analysis?.causalHypotheses[0] || "No semantic hypothesis was stored before this quantitative test."}</p><p className="body-sm" style={{ marginTop: 18 }}>Potential relationship only. The model evaluates incremental out-of-sample information and does not establish causality or guaranteed alpha.</p></section>
      <hr className="rule" />
      <section className="sd-block"><p className="meta sd-q">B — Leakage-safe evidence</p><div className="holds-grid"><div className="holds-item"><p className="meta">Out of sample</p><p className="holds-v"><Verdict passed={passed}>{passed ? "Improved" : "Not improved"}</Verdict></p></div><div className="holds-item"><p className="meta">Evidence score</p><p className="holds-v mono">{test.evidenceScore}/100</p></div><div className="holds-item"><p className="meta">Best lag</p><p className="holds-v mono">{test.bestLag}D</p></div><div className="holds-item"><p className="meta">Sample</p><p className="holds-v mono">{test.sampleSize}</p></div></div><div className="source-facts overview-grid"><span>Baseline R²: {test.baseline.r2.toFixed(4)}</span><span>Augmented R²: {test.augmented.r2.toFixed(4)}</span><span>Delta R²: {test.deltaR2.toFixed(4)}</span><span>Baseline MAE: {test.baseline.mae.toFixed(5)}</span><span>Augmented MAE: {test.augmented.mae.toFixed(5)}</span><span>Directional accuracy: {(test.augmented.directionalAccuracy * 100).toFixed(1)}%</span><span>Pearson: {(best?.pearson || 0).toFixed(4)}</span><span>Spearman: {(best?.spearman || 0).toFixed(4)}</span><span>Mutual information: {test.mutualInformation.toFixed(4)}</span><span>Fold stability: {(test.stabilityAcrossFolds * 100).toFixed(1)}%</span></div></section>
      <section className="source-section"><p className="meta">Walk-forward folds</p><div className="reg-table" style={{ marginTop: 18 }}>{test.folds.map((fold) => <div className="reg-row" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }} key={fold.fold}><span className="mono">Fold {fold.fold}</span><span className="meta">Train {fold.trainSize}</span><span className="meta">Test {fold.testSize}</span><span className={`mono ${fold.deltaR2 > 0 ? "pos" : "neg"}`}>ΔR² {fold.deltaR2.toFixed(4)}</span></div>)}</div></section>
      <section className="source-section"><p className="meta">Warnings</p><p className="body-sm" style={{ marginTop: 12 }}>{test.warnings.length ? test.warnings.join(" · ") : "No automatic warnings. Human review is still required."}</p></section>
      <div style={{ marginTop: 28 }}><Link to={`/sources/${source.id}`} className="btn btn-secondary">Open source and snapshots <span className="arrow">→</span></Link></div>
    </div>
  );
}

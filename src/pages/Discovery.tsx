import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ResearchConfig } from "../api/client";
import type { QarauSource, Run } from "../api/types";
import { SysMeta } from "../components/primitives";

type Phase = "idle" | "running" | "complete";

function sourceMatchesUniverse(source: QarauSource, universe: string) {
  if (universe === "WEATHER") return source.category === "Weather";
  if (universe === "PORTS + LOGISTICS") return ["Logistics", "Mobility", "Water"].includes(source.category);
  if (universe === "ENERGY + INDUSTRY") return ["Energy", "Commodity infrastructure", "Pollution"].includes(source.category);
  return true;
}

export function Discovery() {
  const [cfg, setCfg] = useState<ResearchConfig | null>(null);
  const [target, setTarget] = useState("");
  const [horizon, setHorizon] = useState("");
  const [universe, setUniverse] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [run, setRun] = useState<Run | null>(null);
  const [sources, setSources] = useState<QarauSource[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.config().then((config) => {
      setCfg(config);
      setTarget(config.targets[0] ?? "");
      setHorizon(config.horizons[1] ?? config.horizons[0] ?? "");
      setUniverse(config.universes[0] ?? "");
    }).catch(() => setCfg({ targets: [], universes: [], horizons: [] }));
  }, []);

  const start = async () => {
    setError(null);
    setRun(null);
    setSources([]);
    setPhase("running");
    try {
      const result = await api.startDiscovery(target, horizon, universe);
      const registry = await api.sources({ sort: "candidate", pageSize: "100" });
      setRun(result.run);
      setSources(registry.sources.filter((source) => sourceMatchesUniverse(source, universe)));
      setPhase("complete");
    } catch {
      setPhase("idle");
      setError("Source scan could not be completed.");
    }
  };

  const stats = run?.catalog;
  const tested = (run?.funnel.tested ?? 0) > 0;

  return (
    <div className="shell page">
      <div className="page-head">
        <h1 className="h1">Discover new signals</h1>
        <p className="body" style={{ marginTop: 16 }}>
          Search real-world datasets for predictive relationships with a target financial asset.
        </p>
      </div>

      <section className="cfg">
        <div className="cfg-row">
          <p className="meta cfg-label">Target</p>
          <div className="cfg-opts">
            {(cfg?.targets ?? []).map((value) => (
              <button key={value} className={`opt ${target === value ? "is-active" : ""}`} onClick={() => setTarget(value)} disabled={phase === "running"}>{value}</button>
            ))}
          </div>
        </div>

        <div className="cfg-row">
          <p className="meta cfg-label">Data universe</p>
          <div className="cfg-opts">
            {(cfg?.universes ?? []).map((value) => (
              <button key={value} className={`opt ${universe === value ? "is-active" : ""}`} onClick={() => setUniverse(value)} disabled={phase === "running"}>{value}</button>
            ))}
          </div>
        </div>

        <div className="cfg-row">
          <p className="meta cfg-label">Horizon</p>
          <div className="cfg-opts">
            {(cfg?.horizons ?? []).map((value) => (
              <button key={value} className={`opt ${horizon === value ? "is-active" : ""}`} onClick={() => setHorizon(value)} disabled={phase === "running"}>{value}</button>
            ))}
          </div>
        </div>

        <div className="cfg-go">
          <button className="btn btn-primary" onClick={start} disabled={phase === "running" || !target || !horizon || !universe}>
            {phase === "running" ? "Scanning sources..." : "Scan source registry"} <span className="arrow">→</span>
          </button>
          <SysMeta inline rows={[["RUN", run ? run.id.slice(-12).toUpperCase() : "—"], ["VISIBILITY", "PRIVATE"], ["OWNER", "01"]]} />
        </div>
        {error && <p className="meta gate-error" style={{ marginTop: 20 }}>{error}</p>}
      </section>

      {phase === "complete" && run && stats && (
        <>
          <hr className="rule" />
          <section className="discovery-result">
            <div className="discovery-result-head">
              <div>
                <p className="meta">Discovery result</p>
                <h2 className="h2">{stats.sourcesInScope} real sources in scope</h2>
              </div>
              <p className="meta">RUN / {run.id.slice(-12).toUpperCase()} · {run.status}</p>
            </div>

            <div className="discovery-stats">
              <div><strong>{stats.sourcesInScope}</strong><span>sources indexed</span></div>
              <div><strong>{stats.newSources}</strong><span>new this scan</span></div>
              <div><strong>{stats.snapshotsReady}</strong><span>snapshots ready</span></div>
              <div><strong>{stats.matchingTests}</strong><span>{target} / {horizon} tests</span></div>
              <div><strong>{run.funnel.candidates}</strong><span>retained evidence</span></div>
            </div>

            <div className="discovery-status">
              <p className="body-sm">{run.note}</p>
              <div className="run-links">
                <Link to="/data" className="btn-ghost">Open data registry <span className="arrow">→</span></Link>
                <Link to="/runs" className="btn-ghost">Run log <span className="arrow">→</span></Link>
              </div>
            </div>
          </section>

          {tested && (
            <section className="discovery-validation">
              <div className="discovery-section-head">
                <div><p className="meta">Validation</p><h3>Tests matching this selection</h3></div>
                <span className="meta">{target} / {horizon} / {universe}</span>
              </div>
              <div className="validation-stages">
                <div><strong>{run.funnel.tested}</strong><span>tested</span></div>
                <div><strong>{run.funnel.passedFilters}</strong><span>sample filter</span></div>
                <div><strong>{run.funnel.passedRobustness}</strong><span>robust folds</span></div>
                <div><strong>{run.funnel.passedOOS}</strong><span>positive OOS</span></div>
                <div><strong>{run.funnel.candidates}</strong><span>retained</span></div>
              </div>
              {run.producedSignalIds.length > 0 && <div className="run-links">{run.producedSignalIds.map((id) => <Link key={id} to={`/signals/${id}`} className="btn-ghost">Open SIG / {id.slice(-10).toUpperCase()} <span className="arrow">→</span></Link>)}</div>}
            </section>
          )}

          <section className="discovery-sources">
            <div className="discovery-section-head">
              <div><p className="meta">Registry queue</p><h3>Highest-ranked sources in scope</h3></div>
              <span className="meta">{sources.length} records</span>
            </div>
            <div className="discovery-source-list">
              {sources.slice(0, 6).map((source) => (
                <Link key={source.id} to={`/data/${source.id}`} className="discovery-source-row">
                  <div><span className="meta">{source.provider}</span><strong>{source.name}</strong></div>
                  <span>{source.category} / {source.region}</span>
                  <span>{source.dataset ? `${source.dataset.rows.toLocaleString("en-US")} rows` : "No snapshot"}</span>
                  <span className="discovery-score">{source.scores.candidate}<small>score</small></span>
                  <span className="arrow">→</span>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

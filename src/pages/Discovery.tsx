import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ResearchConfig } from "../api/client";
import type { Lane, Run, RunLanes } from "../api/types";
import { SysMeta, Trace } from "../components/primitives";
import { INK } from "../components/charts";
import { FunnelTrace } from "../components/FunnelTrace";
import { LaneDashboard } from "../components/LaneDashboard";

const DURATION = 3600;

type Phase = "idle" | "running" | "complete";

export function Discovery() {
  // Targets and universes arrive from the API — the set of assets under
  // research is not compiled into the client.
  const [cfg, setCfg] = useState<ResearchConfig | null>(null);
  const [target, setTarget] = useState("");
  const [horizon, setHorizon] = useState("");
  const [universe, setUniverse] = useState("");

  useEffect(() => {
    api.config().then((c) => {
      setCfg(c);
      setTarget((t) => t || c.targets[0]);
      setHorizon((h) => h || c.horizons[1] || c.horizons[0]);
      setUniverse((u) => u || c.universes[0]);
    }).catch(() => setCfg({ targets: [], universes: [], horizons: [] }));
  }, []);

  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [run, setRun] = useState<Run | null>(null);
  const [lanes, setLanes] = useState<RunLanes | null>(null);
  const [selected, setSelected] = useState<Lane | null>(null);
  const [error, setError] = useState<string | null>(null);
  const raf = useRef<number | null>(null);

  const start = async () => {
    setError(null);
    setProgress(0);
    setRun(null);
    setLanes(null);
    setSelected(null);
    try {
      const res = await api.startDiscovery(target, horizon);
      setRun(res.run);
      // Fetch the individual hypotheses alongside the funnel counts so the
      // diagram has something real behind every lane.
      const laneData = await api.runLanes(res.run.id).catch(() => null);
      setLanes(laneData);
      setPhase("running");
    } catch {
      setError("Run could not be started.");
    }
  };

  useEffect(() => {
    if (phase !== "running") return;
    const t0 = performance.now();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setProgress(1);
      setPhase("complete");
      return;
    }

    // Read elapsed wall-clock time rather than accumulating per frame, and
    // keep a timer alongside rAF: browsers pause rAF entirely in a hidden
    // tab, which would otherwise freeze a run started in the background.
    const advance = () => {
      const p = Math.min((performance.now() - t0) / DURATION, 1);
      setProgress(p);
      if (p >= 1) setPhase("complete");
    };
    const loop = () => {
      advance();
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    const keepAlive = window.setInterval(advance, 200);

    return () => {
      window.clearInterval(keepAlive);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [phase]);

  const f = run?.funnel;
  const count = (n: number, from: number, to: number) =>
    Math.round(n * Math.min(Math.max((progress - from) / (to - from), 0), 1)).toLocaleString("en-US");

  return (
    <div className="shell page">
      <div className="page-head">
        <h1 className="h1">Discover new signals</h1>
        <p className="body" style={{ marginTop: 16 }}>
          Search real-world datasets for predictive relationships with a target
          financial asset.
        </p>
      </div>

      {/* -----------------------------------------------------------
          RUN CONFIGURATION
          ----------------------------------------------------------- */}
      <section className="cfg">
        <div className="cfg-row">
          <p className="meta cfg-label">Target</p>
          <div className="cfg-opts">
            {(cfg?.targets ?? []).map((t) => (
              <button
                key={t}
                className={`opt ${target === t ? "is-active" : ""}`}
                onClick={() => setTarget(t)}
                disabled={phase === "running"}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="cfg-row">
          <p className="meta cfg-label">Data universe</p>
          <div className="cfg-opts">
            {(cfg?.universes ?? []).map((u) => (
              <button
                key={u}
                className={`opt ${universe === u ? "is-active" : ""}`}
                onClick={() => setUniverse(u)}
                disabled={phase === "running"}
              >
                {u}
              </button>
            ))}
          </div>
        </div>

        <div className="cfg-row">
          <p className="meta cfg-label">Horizon</p>
          <div className="cfg-opts">
            {(cfg?.horizons ?? []).map((h) => (
              <button
                key={h}
                className={`opt ${horizon === h ? "is-active" : ""}`}
                onClick={() => setHorizon(h)}
                disabled={phase === "running"}
              >
                {h}
              </button>
            ))}
          </div>
        </div>

        <div className="cfg-go">
          <button className="btn btn-primary" onClick={start} disabled={phase === "running" || !target}>
            {phase === "running" ? "Running" : "Run private discovery"} <span className="arrow">→</span>
          </button>
          <SysMeta
            inline
            rows={[
              ["RUN", run?.id ?? "—"],
              ["VISIBILITY", "PRIVATE"],
              ["OWNER", "01"],
            ]}
          />
        </div>
        {error && <p className="meta gate-error" style={{ marginTop: 20 }}>{error}</p>}
      </section>

      {phase !== "idle" && run && f && (
        <>
          <hr className="rule" />

          {/* -------------------------------------------------------
              THE FUNNEL — the system rejecting almost everything.
              ------------------------------------------------------- */}
          <section className="scan">
            <div className="scan-trace">
              <FunnelTrace
                data={lanes}
                progress={progress}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
              />
            </div>

            <aside className="scan-side">
              <SysMeta
                rows={[
                  ["RUN", run.id],
                  ["TARGET", run.target],
                  ["HORIZON", run.horizon],
                  ["UNIVERSE", universe],
                ]}
              />

              <div className="funnel" style={{ marginTop: 34 }}>
                {(
                  [
                    [f.datasets, "datasets", 0, 0.12],
                    [f.features, "features generated", 0.1, 0.28],
                    [f.tested, "relationships tested", 0.24, 0.46],
                    [f.passedFilters, "passed initial filters", 0.44, 0.62],
                    [f.passedRobustness, "passed robustness", 0.6, 0.78],
                    [f.passedOOS, "passed out-of-sample", 0.76, 0.92],
                    [f.candidates, "proprietary candidates", 0.9, 1],
                  ] as [number, string, number, number][]
                ).map(([v, k, a, b], i) => (
                  <div key={k} className="funnel-row">
                    <span className="funnel-n mono">{count(v, a, b)}</span>
                    <span className="funnel-k">{k}</span>
                    <span className="funnel-bar" style={{ width: `${100 - i * 13}%` }} />
                  </div>
                ))}
              </div>
            </aside>
          </section>

          {selected && run && (
            <LaneDashboard
              lane={selected}
              target={run.target}
              runId={run.id}
              onClose={() => setSelected(null)}
            />
          )}

          {phase === "complete" && (
            <>
              <hr className="rule" />
              <section className="run-out">
                <div className="run-out-head">
                  <h2 className="h2">
                    {run.producedSignalIds.length > 0
                      ? "Survived validation"
                      : "Nothing survived validation"}
                  </h2>
                  <p className="meta">
                    Run / {run.id} · {run.status}
                  </p>
                </div>

                {run.producedSignalIds.length > 0 ? (
                  <p className="body-sm" style={{ maxWidth: "60ch", marginTop: 14 }}>
                    {f.tested.toLocaleString("en-US")} relationships tested,{" "}
                    {run.producedSignalIds.length} retained as proprietary. Added to the
                    private inventory.
                  </p>
                ) : (
                  <p className="body-sm" style={{ maxWidth: "60ch", marginTop: 14 }}>
                    {run.note ?? "No relationship in this universe survived out-of-sample validation."}
                  </p>
                )}

                <div className="run-links">
                  {run.producedSignalIds.map((id) => (
                    <Link key={id} to={`/signals/${id}`} className="btn-ghost">
                      Open SIG / {id} <span className="arrow">→</span>
                    </Link>
                  ))}
                  <Link to="/runs" className="btn-ghost">
                    Full run log <span className="arrow">→</span>
                  </Link>
                </div>

                {run.rejected.length > 0 && (
                  <div className="rej-list">
                    <p className="meta" style={{ marginBottom: 20 }}>
                      Rejected in this run
                    </p>
                    {run.rejected.map((r) => (
                      <div key={r.name} className="rej">
                        <div className="rej-main">
                          <p className="rej-name">{r.name}</p>
                          <p className="meta" style={{ marginTop: 8 }}>
                            Failed at {r.stage}
                          </p>
                        </div>
                        <div className="rej-trace">
                          <Trace seed={r.name.length * 733} width={200} height={22} state="broken" tone={INK.neg} />
                        </div>
                        <p className="body-sm rej-why">{r.reason}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

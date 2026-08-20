import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Run } from "../api/types";
import { SysMeta, Trace } from "../components/primitives";
import { INK } from "../components/charts";

export function Runs() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api.runs().then((r) => setRuns(r.runs)).catch(() => setRuns([]));
  }, []);

  if (!runs) return <div className="shell page"><p className="meta">Loading run log</p></div>;

  const complete = runs.filter((r) => r.status === "COMPLETE").length;
  const rejected = runs.length - complete;

  return (
    <div className="shell page">
      <div className="data-head">
        <div>
          <h1 className="h1">Experiment runs</h1>
          <p className="body" style={{ marginTop: 16 }}>
            Every discovery run, including the ones that produced nothing. Negative
            research is kept — it is the record of what has already been ruled out.
          </p>
        </div>
        <SysMeta
          rows={[
            ["RUNS", String(runs.length)],
            ["PRODUCED SIGNALS", String(complete)],
            ["WHOLE-RUN REJECTIONS", String(rejected)],
          ]}
        />
      </div>

      <div className="runs">
        {runs.map((r) => {
          const expanded = open === r.id;
          const failed = r.status === "REJECTED";
          return (
            <article key={r.id} className={`run ${failed ? "is-failed" : ""}`}>
              <button
                className="run-head"
                onClick={() => setOpen(expanded ? null : r.id)}
                aria-expanded={expanded}
              >
                <span className="mono run-id">RUN / {r.id}</span>
                <span className="run-target mono">{r.target}</span>
                <span className="meta">{r.horizon}</span>
                <span className="run-universe meta">{r.universe}</span>
                <span className="mono run-num">{r.funnel.tested.toLocaleString("en-US")}</span>
                <span className="meta run-numlabel">tested</span>
                <span className="mono run-num">{r.survivors}</span>
                <span className="meta run-numlabel">survivors</span>
                <span className={`run-status meta ${failed ? "is-failed" : ""}`}>{r.status}</span>
                <span className="meta run-date">{r.date}</span>
                <span className="run-caret" aria-hidden="true">{expanded ? "−" : "+"}</span>
              </button>

              {expanded && (
                <div className="run-body">
                  <div className="run-funnel">
                    {(
                      [
                        [r.funnel.datasets, "datasets"],
                        [r.funnel.features, "features"],
                        [r.funnel.tested, "tested"],
                        [r.funnel.passedFilters, "passed filters"],
                        [r.funnel.passedRobustness, "passed robustness"],
                        [r.funnel.passedOOS, "passed out-of-sample"],
                        [r.funnel.candidates, "proprietary"],
                      ] as [number, string][]
                    ).map(([v, k], i) => (
                      <div key={k} className="run-fstep">
                        <span className="mono run-fv">{v.toLocaleString("en-US")}</span>
                        <span className="meta">{k}</span>
                        <span className="run-fbar" style={{ width: `${100 - i * 13}%` }} />
                      </div>
                    ))}
                  </div>

                  <div className="run-detail">
                    {r.note && <p className="body-sm run-note">{r.note}</p>}

                    {r.producedSignalIds.length > 0 && (
                      <div className="run-produced">
                        <p className="meta">Produced</p>
                        <div className="run-links" style={{ marginTop: 12 }}>
                          {r.producedSignalIds.map((id) => (
                            <Link key={id} to={`/signals/${id}`} className="btn-ghost">
                              SIG / {id} <span className="arrow">→</span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="run-rejected">
                      <p className="meta" style={{ marginBottom: 18 }}>Rejected hypotheses</p>
                      {r.rejected.map((x) => (
                        <div key={x.name} className="rej">
                          <div className="rej-main">
                            <p className="rej-name">{x.name}</p>
                            <p className="meta" style={{ marginTop: 8 }}>Failed at {x.stage}</p>
                          </div>
                          <div className="rej-trace">
                            <Trace
                              seed={x.name.length * 733}
                              width={190}
                              height={22}
                              state="broken"
                              tone={INK.neg}
                              breakAt={x.stage === "INITIAL" ? 0.34 : x.stage === "ROBUSTNESS" ? 0.58 : 0.78}
                            />
                          </div>
                          <p className="body-sm rej-why">{x.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <p className="meta muted" style={{ marginTop: 40, lineHeight: 1.8 }}>
        Run log is append-only. Simulated throughout.
      </p>
    </div>
  );
}

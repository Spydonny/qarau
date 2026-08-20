import { Link } from "react-router-dom";
import type { Lane } from "../api/types";
import { makeLagProfile, makeRollingIc, makeSeries } from "../lib/series";
import { LagChart, LineChart, Sparkline } from "./charts";
import { Coords, Fingerprint, LagMarkers, SysMeta } from "./primitives";
import { Relationship } from "./Relationship";
import { HealthBar, Verdict } from "./health";

/* ============================================================
   LANE DASHBOARD

   The full record behind one lane of the funnel — including the
   ones that died. Negative research is kept and is readable:
   knowing an instrument was tested and failed is worth as much
   as knowing one worked.
   ============================================================ */

const X_LABELS = ["T−220D", "T−165D", "T−110D", "T−55D", "T0"];

export function LaneDashboard({
  lane,
  target,
  runId,
  onClose,
}: {
  lane: Lane;
  target: string;
  runId: string;
  onClose: () => void;
}) {
  const d = lane.dataset;
  const series = makeSeries(lane.seed, 220, lane.lag);
  const lagProfile = makeLagProfile(lane.lag, lane.ic);
  const rolling = makeRollingIc(lane.seed, lane.ic, lane.survived ? 14 : 72);

  // A failed hypothesis has no out-of-sample result to show, so the boundary
  // is only drawn where one actually exists.
  const oosIndex = lane.survived ? series.oosIndex : undefined;

  return (
    <section className="ld" aria-label="Hypothesis record">
      <header className="ld-head">
        <div>
          <div className="ld-id">
            <p className="mono ld-lane">LANE / {lane.id}</p>
            <Verdict passed={lane.survived}>
              {lane.survived ? "Survived" : `Failed at ${lane.diedAtLabel}`}
            </Verdict>
          </div>
          <h3 className="ld-name">
            {d?.name ?? "Unknown source"} <span className="arrow-to">→</span>{" "}
            <span className="mono">{target}</span>
          </h3>
        </div>
        <button className="ld-close meta" onClick={onClose} aria-label="Close record">
          Close ×
        </button>
      </header>

      <div className="ld-body">
        {/* --- The instrument ------------------------------------ */}
        <div className="ld-col">
          <p className="meta ld-label">Instrument</p>
          {d ? (
            <>
              <SysMeta
                rows={[
                  ["DATA", d.id],
                  ["SOURCE", d.sourceType],
                  ["REGION", d.region],
                  ["FREQ", d.frequency],
                  ["HISTORY", `${d.historyYears.toFixed(1)}Y`],
                  ["COVERAGE", d.coverage.toUpperCase()],
                ]}
              />
              <p className="coords-line">
                <Coords lat={d.site.lat} lon={d.site.lon} />
                <span className="coords-place">
                  {d.site.city} / {d.site.country}
                </span>
              </p>
              <div className="ld-quality">
                <HealthBar label="Data quality" value={d.quality} />
                <HealthBar label="Stability" value={lane.stability} />
              </div>
            </>
          ) : (
            <p className="body-sm">No instrument record.</p>
          )}
        </div>

        {/* --- The claim ----------------------------------------- */}
        <div className="ld-col">
          <p className="meta ld-label">Relationship</p>
          <Relationship
            state={lane.survived ? "validated" : "rejected"}
            lag={lane.lag}
            source={d?.name ?? "Observation"}
            target={target}
            height={130}
          />
          <div className="ld-lagline">
            <LagMarkers lead={lane.lag} width={240} />
          </div>
        </div>

        {/* --- The measurement ----------------------------------- */}
        <div className="ld-col">
          <p className="meta ld-label">Measurement</p>
          <div className="ld-metrics">
            <div>
              <p className="meta">Tested lead</p>
              <p className="ld-v mono">{lane.lag}D</p>
            </div>
            <div>
              <p className="meta">Information coefficient</p>
              <p className={`ld-v mono ${lane.survived ? "pos" : "neg"}`}>
                {lane.ic.toFixed(3)}
              </p>
            </div>
            <div>
              <p className="meta">Reached stage</p>
              <p className="ld-v mono">
                {lane.reachedStage + 1} / 5
              </p>
            </div>
          </div>
          <div className="ld-fp">
            <Fingerprint
              signal={{ bestLag: lane.lag, ic: lane.ic, stability: lane.stability, seed: lane.seed }}
              width={132}
              height={40}
              showAxis
            />
            <p className="meta" style={{ marginTop: 10 }}>Response by lead</p>
          </div>
        </div>
      </div>

      {/* --- Evidence ------------------------------------------- */}
      <div className="ld-charts">
        <div>
          <p className="meta">Observation against target</p>
          <div style={{ marginTop: 18 }}>
            <LineChart
              height={200}
              oosIndex={oosIndex}
              xLabels={X_LABELS}
              agreement={{ predictor: 0, target: 1, lagSteps: lane.lag }}
              series={[
                { label: d?.name ?? "Observation", values: series.signal, tone: "primary", width: 1.3 },
                { label: target, values: series.asset, tone: "mid" },
              ]}
            />
          </div>
        </div>

        <div className="ld-side">
          <p className="meta">Strength by lead</p>
          <div style={{ marginTop: 16 }}>
            <LagChart data={lagProfile} bestLag={lane.lag} height={120} />
          </div>

          <p className="meta" style={{ marginTop: 30 }}>Rolling IC</p>
          <div style={{ marginTop: 14 }}>
            <Sparkline values={rolling} width={240} height={46} signed />
          </div>
        </div>
      </div>

      {/* --- Verdict -------------------------------------------- */}
      <footer className="ld-foot">
        {lane.survived ? (
          <>
            <div>
              <p className="meta">Outcome</p>
              <p className="body-sm ld-reason">
                Held through every stage and was retained as proprietary research.
              </p>
            </div>
            {lane.signalId && (
              <Link to={`/signals/${lane.signalId}`} className="btn btn-secondary">
                Open SIG / {lane.signalId} <span className="arrow">→</span>
              </Link>
            )}
          </>
        ) : (
          <>
            <div>
              <p className="meta">Why it was discarded</p>
              <p className="body-sm ld-reason">{lane.reason}</p>
            </div>
            <p className="meta muted ld-kept">
              Kept as negative research · Run / {runId}
            </p>
          </>
        )}
      </footer>
    </section>
  );
}

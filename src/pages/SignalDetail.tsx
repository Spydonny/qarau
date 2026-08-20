import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { SignalDetail as Detail } from "../api/types";
import { makeEquity, makeLagProfile, makeRollingIc, makeScatter, makeSeries } from "../lib/series";
import { LagChart, LineChart, Scatter, Sparkline } from "../components/charts";
import { CountUp } from "../components/CountUp";
import { Reveal } from "../components/Reveal";
import { Coords, Fingerprint, LagMarkers, SysMeta } from "../components/primitives";
import { CrowdingMark, HealthBar, StatusMark, Verdict } from "../components/health";
import { Relationship } from "../components/Relationship";

const X_LABELS = ["T−220D", "T−165D", "T−110D", "T−55D", "T0"];

export function SignalDetail() {
  const { id = "" } = useParams();
  const [s, setS] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setS(null);
    setMissing(false);
    api.signal(id).then(setS).catch(() => setMissing(true));
  }, [id]);

  if (missing) {
    return (
      <div className="shell page">
        <h1 className="h1">No such signal</h1>
        <Link to="/signals" className="btn-ghost" style={{ marginTop: 24 }}>
          Back to inventory <span className="arrow">→</span>
        </Link>
      </div>
    );
  }
  if (!s) return <div className="shell page"><p className="meta">Opening research file</p></div>;

  const series = makeSeries(s.seed, 220, s.bestLag);
  const uplift = s.sharpeAfter - s.sharpeBefore;
  const equity = makeEquity(s.seed, 220, uplift * 2.4);
  const scatter = makeScatter(s.seed);
  const lagProfile = makeLagProfile(s.bestLag, s.ic);
  const rollingIc = makeRollingIc(s.seed, s.ic, s.health.decay);

  return (
    <div className="shell page">
      <Link to="/signals" className="btn-ghost">
        <span aria-hidden="true">←</span> Inventory
      </Link>

      {/* ===========================================================
          HEADER — one restrained proprietary marker, nothing more.
          =========================================================== */}
      <header className="sd-head">
        <div className="sd-id">
          <p className="mono sd-sig">SIG / {s.id}</p>
          <span className="proprietary">Proprietary</span>
          <StatusMark status={s.status} />
        </div>

        <h1 className="display-sm sd-title">
          {s.name}
          <span className="sd-arrow" aria-hidden="true">→</span>
          <span className="sd-target">{s.targetName}</span>
        </h1>

        <div className="sd-provenance">
          <SysMeta
            inline
            rows={[
              ["ACCESS", "OWNER"],
              ["VISIBILITY", "INTERNAL"],
              ["CREATED", s.created],
              ["LAST VALIDATED", `${s.lastValidatedHoursAgo}H AGO`],
              ["DATA", s.dataset ? `${s.dataset.id}` : "—"],
            ]}
          />
        </div>
      </header>

      {/* ===========================================================
          A — THESIS
          =========================================================== */}
      <section className="sd-block">
        <p className="meta sd-q">A — Thesis</p>
        <p className="sd-thesis">{s.thesis}</p>

        <div className="sd-hyp">
          <div>
            <p className="meta">Hypothesis</p>
            <p className="body-sm" style={{ marginTop: 14, maxWidth: "52ch" }}>
              {s.hypothesis}
            </p>
            <p className="meta muted" style={{ marginTop: 20, lineHeight: 1.7 }}>
              Stated as a hypothesis. This is an observed statistical relationship, not
              demonstrated causality.
            </p>
          </div>
          <div className="sd-rel">
            <Relationship
              state="validated"
              lag={s.bestLag}
              source={s.dataset?.name ?? "Observation"}
              target={s.target}
            />
          </div>
        </div>

        <div className="sd-lead">
          <div>
            <p className="metric mono">{s.bestLag} days</p>
            <p className="meta" style={{ marginTop: 12 }}>Observed lead</p>
          </div>
          <div className="sd-lead-marks">
            <LagMarkers lead={s.bestLag} width={300} />
          </div>
          <div className="sd-lead-fp">
            <Fingerprint
              signal={{ bestLag: s.bestLag, ic: s.ic, stability: s.health.stability, seed: s.seed }}
              width={132}
              height={46}
              showAxis
            />
            <p className="meta" style={{ marginTop: 10 }}>Response by lead</p>
          </div>
          <div>
            <p className="mono sd-dir">{s.direction}</p>
            <p className="meta" style={{ marginTop: 12 }}>Direction</p>
          </div>
        </div>
      </section>

      <section className="sd-chart">
        <div className="chart-key">
          <p className="meta">
            {s.target} coloured by whether the observation called the move
          </p>
          <div className="chart-key-items">
            <span className="meta chart-key-item pos">
              <span className="chart-key-rule" aria-hidden="true" /> Working
            </span>
            <span className="meta chart-key-item neg">
              <span className="chart-key-rule" aria-hidden="true" /> Not working
            </span>
          </div>
        </div>
        <LineChart
          height={380}
          oosIndex={series.oosIndex}
          xLabels={X_LABELS}
          leadMarker={{ at: 44, lagSteps: s.bestLag * 2, label: `${s.bestLag}D LEAD` }}
          // The observation leads the asset by exactly bestLag samples here,
          // which is what makes the hit test meaningful rather than decorative.
          agreement={{ predictor: 0, target: 1, lagSteps: s.bestLag }}
          series={[
            { label: s.name, values: series.signal, tone: "primary", width: 1.4 },
            { label: s.target, values: series.asset, tone: "mid" },
            { label: "Sector benchmark", values: series.benchmark, tone: "dark" },
          ]}
        />
        <p className="body-sm chart-note">
          The strip under the plot is the raw per-sample hit rate. What matters is
          whether the green survives the out-of-sample boundary — in-sample agreement
          is what every discarded hypothesis also had.
        </p>
      </section>

      <hr className="rule" />

      {/* ===========================================================
          B — EVIDENCE
          =========================================================== */}
      <section className="sd-block">
        <p className="meta sd-q">B — Evidence</p>

        <div className="holds-grid">
          <div className="holds-item">
            <p className="meta">In sample</p>
            <p className="holds-v"><Verdict passed={s.ic > 0}>Held</Verdict></p>
            <p className="sig-sub mono">IC {s.ic.toFixed(3)}</p>
          </div>
          <div className="holds-item">
            <p className="meta">Out of sample</p>
            <p className="holds-v">
              <Verdict passed={s.oosPassed}>{s.oosPassed ? "Held" : "Failed"}</Verdict>
            </p>
            <p className="sig-sub mono">IC {s.oosIc.toFixed(3)}</p>
          </div>
          <div className="holds-item">
            <p className="meta">Regimes held</p>
            <p className="holds-v">
              {s.regimes.filter((r) => r.held).length} / {s.regimes.length}
            </p>
            <p className="sig-sub">market conditions</p>
          </div>
          <div className="holds-item">
            <p className="meta">Validation window</p>
            <p className="holds-v mono" style={{ fontSize: 17 }}>{s.validationWindow}</p>
            <p className="sig-sub">walk-forward</p>
          </div>
        </div>

        <div className="regimes">
          {s.regimes.map((r) => (
            <div key={r.label} className="regime">
              <span className="regime-label">{r.label}</span>
              <span className="regime-track">
                <span
                  className={`regime-fill ${r.held ? "" : "is-out"}`}
                  style={{ width: `${Math.min((Math.max(r.ic, 0) / 0.1) * 100, 100)}%` }}
                />
              </span>
              <span className="regime-ic mono">{r.ic.toFixed(3)}</span>
              <span className={`regime-verdict ${r.held ? "pos" : "neg"}`}>
                {r.held ? "held" : "weakened"}
              </span>
            </div>
          ))}
        </div>

        <div className="sd-diag">
          <div>
            <p className="meta">Strength by lead</p>
            <p className="body-sm" style={{ marginTop: 10, marginBottom: 22 }}>
              A real relationship peaks at one lead and decays either side. Noise is flat.
            </p>
            <LagChart data={lagProfile} bestLag={s.bestLag} />
          </div>
          <div>
            <p className="meta">Observation against forward move</p>
            <p className="body-sm" style={{ marginTop: 10, marginBottom: 22 }}>
              One point per observation. Modest slope, large scatter, consistent sign.
            </p>
            <Scatter points={scatter} />
          </div>
        </div>

        <div className="verdict">
          <p className="meta">Validation</p>
          <p className="verdict-v">
            <Verdict passed={s.oosPassed}>{s.oosPassed ? "Passed" : "Failed"}</Verdict>
          </p>
        </div>
      </section>

      <hr className="rule" />

      {/* ===========================================================
          C — STRATEGY VALUE
          =========================================================== */}
      <section className="sd-payoff">
        <p className="meta sd-q">C — Strategy value</p>

        <div className="cmp">
          <div className="cmp-col">
            <p className="meta cmp-title">Without signal</p>
            {(
              [
                [s.sharpeBefore, "Sharpe", 2, ""],
                [s.returnBefore, "Return", 1, "%"],
                [s.ddBefore, "Max drawdown", 1, "%"],
              ] as [number, string, number, string][]
            ).map(([v, k, d, suf], i) => (
              <Reveal key={k} delay={i * 80} className="cmp-metric">
                <p className="metric"><CountUp value={v} decimals={d} suffix={suf} /></p>
                <p className="meta" style={{ marginTop: 12 }}>{k}</p>
              </Reveal>
            ))}
          </div>

          <div className="cmp-divider" aria-hidden="true" />

          <div className="cmp-col is-emphasis">
            <p className="meta cmp-title">With signal</p>
            {(
              [
                [s.sharpeAfter, "Sharpe", 2, ""],
                [s.returnAfter, "Return", 1, "%"],
                [s.ddAfter, "Max drawdown", 1, "%"],
              ] as [number, string, number, string][]
            ).map(([v, k, d, suf], i) => (
              <Reveal key={k} delay={i * 80} className="cmp-metric">
                <p className="metric"><CountUp value={v} decimals={d} suffix={suf} /></p>
                <p className="meta" style={{ marginTop: 12 }}>{k}</p>
              </Reveal>
            ))}
          </div>
        </div>

        <div className="uplift">
          <p className={`display uplift-figure ${uplift >= 0 ? "pos" : "neg"}`}>
            <CountUp value={uplift} decimals={2} signed /> Sharpe
          </p>
          <p className="meta" style={{ marginTop: 20 }}>Incremental contribution</p>
        </div>
      </section>

      <section className="equity">
        <p className="meta" style={{ marginBottom: 24 }}>
          Cumulative equity · 100 at inception
        </p>
        <LineChart
          height={240}
          oosIndex={equity.oosIndex}
          xLabels={X_LABELS}
          // Same units, so one scale — and the shaded gap between them is
          // the incremental contribution, made literal.
          sharedScale
          band={{ a: 0, b: 1 }}
          series={[
            { label: "With signal", values: equity.lifted, tone: "primary", width: 1.4 },
            { label: "Without signal", values: equity.base, tone: "dark" },
          ]}
        />
      </section>

      <hr className="rule" />

      {/* ===========================================================
          D — SIGNAL HEALTH
          =========================================================== */}
      <section className="sd-block">
        <p className="meta sd-q">D — Signal health</p>
        <p className="body-sm" style={{ maxWidth: "58ch", marginBottom: 34 }}>
          Alpha is not permanent. Every active signal is re-validated on a schedule and
          retired when it stops earning its allocation.
        </p>

        <div className="health-grid">
          <div className="health-bars">
            <HealthBar label="Stability" value={s.health.stability} />
            <HealthBar label="Decay" value={s.health.decay} invert />
            <HealthBar label="Data quality" value={s.health.dataQuality} />
            <HealthBar label="Regime robustness" value={s.health.regimeRobustness} />
            {/* The note sits in the flexible column: the third one is sized
                for a two-digit score and a word overflows it. */}
            <div className="hb">
              <span className="meta hb-label">Crowding</span>
              <span className="hb-crowd">
                {s.health.crowding} <CrowdingMark level={s.health.crowding} />
                <span className="meta muted hb-note">heuristic</span>
              </span>
              <span aria-hidden="true" />
            </div>
          </div>

          <div className="health-side">
            <p className="meta">Rolling IC</p>
            <div style={{ marginTop: 16 }}>
              <Sparkline values={rollingIc} width={260} height={54} signed />
            </div>
            <p className="meta muted" style={{ marginTop: 14, lineHeight: 1.7 }}>
              Trailing information coefficient across the validation window.
            </p>

            <div className="health-status">
              <p className="meta">Current status</p>
              <div style={{ marginTop: 12 }}>
                <StatusMark status={s.status} />
              </div>
            </div>
          </div>
        </div>

        <div className="notes">
          <p className="meta">Research notes</p>
          <p className="body-sm" style={{ marginTop: 14, maxWidth: "64ch" }}>{s.notes}</p>
        </div>

        {s.dataset && (
          <div className="dep">
            <p className="meta">Data dependency</p>
            <div className="dep-row">
              <span className="mono">DATA / {s.dataset.id}</span>
              <span className="dep-name">{s.dataset.name}</span>
              <span className="meta">{s.dataset.sourceType}</span>
              <span className="mono">{s.dataset.frequency}</span>
              <span className="meta">Quality {s.dataset.quality}</span>
              <span className="dep-coords">
                <Coords lat={s.dataset.site.lat} lon={s.dataset.site.lon} />
              </span>
            </div>
            {s.runs.length > 0 && (
              <p className="meta muted" style={{ marginTop: 18 }}>
                Discovered in run / {s.runs.map((r) => r.id).join(", ")}
              </p>
            )}
          </div>
        )}
      </section>

      <p className="meta muted sd-disclaimer">
        Simulated result. Costs modelled at 8bp per turn. A measured relationship may stop
        holding at any time. Internal research record — not investment advice.
      </p>
    </div>
  );
}

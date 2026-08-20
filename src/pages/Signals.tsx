import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { InventoryStats, SignalStatus, SignalSummary } from "../api/types";
import { Fingerprint, SysMeta } from "../components/primitives";
import { StatusMark, HealthBar, Verdict } from "../components/health";

const FILTERS: (SignalStatus | "ALL")[] = [
  "ALL",
  "ACTIVE",
  "WATCHLIST",
  "DEGRADING",
  "RETIRED",
];

function age(hours: number) {
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function Signals() {
  const [data, setData] = useState<{ stats: InventoryStats; signals: SignalSummary[] } | null>(null);
  const [filter, setFilter] = useState<SignalStatus | "ALL">("ALL");
  const [error, setError] = useState(false);

  useEffect(() => {
    api.signals().then(setData).catch(() => setError(true));
  }, []);

  if (error) return <div className="shell page"><p className="meta">Could not load inventory.</p></div>;
  if (!data) return <div className="shell page"><p className="meta">Loading inventory</p></div>;

  const shown = data.signals.filter((s) => filter === "ALL" || s.status === filter);

  return (
    <div className="shell page">
      <div className="data-head">
        <div>
          <h1 className="h1">Proprietary signals</h1>
          <p className="body" style={{ marginTop: 16 }}>
            The private inventory of validated research. Monitored continuously —
            alpha is not permanent.
          </p>
        </div>
        <SysMeta
          rows={[
            ["ACCESS", "OWNER"],
            ["VISIBILITY", "INTERNAL"],
            ["INVENTORY", String(data.stats.total)],
          ]}
        />
      </div>

      {/* Counts are computed server-side from the list below them. */}
      <div className="inv-stats">
        {(
          [
            [data.stats.active, "Active"],
            [data.stats.watchlist, "Watchlist"],
            [data.stats.degrading, "Degrading"],
            [data.stats.retired, "Retired"],
            [data.stats.rejected, "Rejected"],
          ] as [number, string][]
        ).map(([v, k]) => (
          <div key={k} className="inv-stat">
            <p className="metric-sm mono">{String(v).padStart(2, "0")}</p>
            <p className="meta">{k}</p>
          </div>
        ))}
      </div>

      <div className="register-head">
        <p className="meta">Filter</p>
        <div className="filters">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`filter ${filter === f ? "is-active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="sig-list">
        {shown.map((s) => (
          <article key={s.id} className="sigrow">
            <div className="sigrow-id">
              <p className="mono sigrow-sig">SIG / {s.id}</p>
              <StatusMark status={s.status} />
            </div>

            <div className="sigrow-main">
              <h2 className="sigrow-name">
                {s.name} <span className="arrow-to">→</span>{" "}
                <span className="mono">{s.target}</span>
              </h2>
              <div className="sigrow-fp">
                <Fingerprint
                  signal={{ bestLag: s.bestLag, ic: s.ic, stability: s.stability, seed: s.seed }}
                  width={112}
                  height={30}
                  showAxis
                />
              </div>
            </div>

            <dl className="sigrow-metrics">
              <div>
                <dt className="meta">Best lead</dt>
                <dd className="mono">{s.bestLag}D</dd>
              </div>
              <div>
                <dt className="meta">Out of sample</dt>
                <dd className="mono">
                  <Verdict passed={s.oosPassed}>{s.oosPassed ? "Passed" : "Failed"}</Verdict>
                </dd>
              </div>
              <div>
                <dt className="meta">Sharpe</dt>
                <dd className="mono">
                  <span className="dim">{s.sharpeBefore.toFixed(2)}</span>
                  <span className="arrow-to">→</span>
                  <span className={s.sharpeAfter >= s.sharpeBefore ? "pos" : "neg"}>
                    {s.sharpeAfter.toFixed(2)}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="meta">Crowding</dt>
                <dd className="mono">{s.crowding}</dd>
              </div>
            </dl>

            <div className="sigrow-health">
              <HealthBar label="Stability" value={s.stability} />
              <HealthBar label="Decay" value={s.decay} invert />
              <p className="meta muted" style={{ marginTop: 12 }}>
                Validated {age(s.lastValidatedHoursAgo)}
              </p>
            </div>

            <div className="sigrow-go">
              <Link to={`/signals/${s.id}`} className="btn-ghost">
                Open research <span className="arrow">→</span>
              </Link>
            </div>
          </article>
        ))}
      </div>

      <p className="meta muted" style={{ marginTop: 40, lineHeight: 1.8 }}>
        Rejected count aggregates hypotheses that reached robustness testing across all
        runs. Simulated throughout.
      </p>
    </div>
  );
}

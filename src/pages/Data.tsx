import { Suspense, lazy, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Dataset, Gap } from "../api/types";
import { Coords, SysMeta } from "../components/primitives";
import { Relationship } from "../components/Relationship";

// Coastline data is ~57 kB gzipped and only this page draws a map.
const CoverageMap = lazy(() =>
  import("../components/ObservationField").then((m) => ({ default: m.ObservationField })),
);
const CoverageLegend = lazy(() =>
  import("../components/ObservationField").then((m) => ({ default: m.CoverageLegend })),
);

export function Data() {
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [gaps, setGaps] = useState<Gap[] | null>(null);

  useEffect(() => {
    api.datasets().then((r) => setDatasets(r.datasets)).catch(() => setDatasets([]));
    api.gaps().then((r) => setGaps(r.gaps)).catch(() => setGaps([]));
  }, []);

  if (!datasets || !gaps) {
    return <div className="shell page"><p className="meta">Loading data universe</p></div>;
  }

  const extracted = datasets.reduce((n, d) => n + d.activeSignals, 0);

  return (
    <div className="shell page">
      <div className="data-head">
        <div>
          <h1 className="h1">Data universe</h1>
          <p className="body" style={{ marginTop: 16 }}>
            Real-world datasets available to the research engine. The question is not what
            a dataset costs — it is how much proprietary information has been extracted
            from it.
          </p>
        </div>
        <SysMeta
          rows={[
            ["DATASETS", String(datasets.length)],
            ["ACTIVE SIGNALS", String(extracted)],
            ["VISIBILITY", "INTERNAL"],
          ]}
        />
      </div>

      <section className="field-section">
        <Suspense fallback={<div style={{ height: 480 }} />}>
          <CoverageLegend
            reporting={datasets.filter((d) => d.coverage === "reporting").length}
            historical={datasets.filter((d) => d.coverage === "historical").length}
            gaps={gaps.length}
          />
          <CoverageMap sites={datasets.map((d) => ({ ...d.site, label: d.name, status: d.coverage }))}
            gaps={gaps.map((g) => ({ ...g.site, label: g.observation }))} />
        </Suspense>
      </section>

      <hr className="rule" />

      {/* -----------------------------------------------------------
          THE REGISTER
          ----------------------------------------------------------- */}
      <section className="register">
        <p className="meta" style={{ marginBottom: 26 }}>Sources</p>

        <div className="reg-table">
          <div className="reg-row reg-header">
            <span className="meta">Data</span>
            <span className="meta">Source type</span>
            <span className="meta">Region</span>
            <span className="meta">Freq</span>
            <span className="meta">History</span>
            <span className="meta">Quality</span>
            <span className="meta">Extracted</span>
          </div>

          {datasets.map((d) => (
            <div key={d.id} className="reg-row">
              <span className="reg-site">
                <span className="mono reg-did">{d.id}</span>
                {d.name}
              </span>
              <span className="meta">{d.sourceType}</span>
              <span className="mono reg-freq">{d.region}</span>
              <span className="mono reg-freq">{d.frequency}</span>
              <span className="mono reg-freq">{d.historyYears.toFixed(1)}Y</span>
              <span className="reg-quality">
                <span className="hb-track" style={{ width: 46 }}>
                  <span className="hb-fill" style={{ width: `${d.quality}%` }} />
                </span>
                <span className="mono">{d.quality}</span>
              </span>
              <span className="reg-extracted">
                <span className="mono">{d.activeSignals} active</span>
                <span className="meta muted">{d.candidates} candidates</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <hr className="rule" />

      {/* -----------------------------------------------------------
          COVERAGE GAPS
          The measurement is stated. The reason for wanting it is not.
          ----------------------------------------------------------- */}
      <section className="gaps">
        <div className="gaps-head">
          <h2 className="h2">Coverage gaps</h2>
          <p className="body-sm" style={{ marginTop: 14, maxWidth: "62ch" }}>
            Observations the engine would test but which do not exist, or are not available
            at sufficient quality. Each can be turned into an internal data request that
            states the measurement without disclosing the hypothesis behind it.
          </p>
        </div>

        {gaps.map((g) => (
          <article key={g.id} className="gap">
            <div className="gap-main">
              <p className="mono gap-id">OBS / {g.id}</p>
              <h3 className="gap-name">{g.observation}</h3>
              <p className="meta" style={{ marginTop: 10 }}>{g.region}</p>
              <p className="coords-line">
                <Coords lat={g.site.lat} lon={g.site.lon} />
              </p>
            </div>

            <div className="gap-rel">
              {/* The dotted rail is the finding: nothing is measuring this. */}
              <Relationship state="missing" source={g.observation} target="Market" height={112} />
            </div>

            <dl className="gap-spec">
              <div>
                <dt className="meta">Desired frequency</dt>
                <dd className="mono">{g.desiredFrequency}</dd>
              </div>
              <div>
                <dt className="meta">Target hypothesis</dt>
                <dd className="mono gap-hidden">Hidden</dd>
              </div>
              <div>
                <dt className="meta">Research value</dt>
                <dd className="mono">{g.researchValue}</dd>
              </div>
              <div>
                <dt className="meta">Status</dt>
                <dd className="mono">{g.status}</dd>
              </div>
            </dl>

            <div className="gap-go">
              <button className="btn-ghost">
                Create internal data request <span className="arrow">→</span>
              </button>
              {/* Visible to the owner, excluded from anything published
                  outwards — the whole point of the separation. */}
              <p className="meta muted gap-internal-label">Internal · not in request</p>
              <p className="body-sm gap-internal">{g.internalNote}</p>
            </div>
          </article>
        ))}

        <div className="acq">
          <p className="meta">Acquisition model</p>
          <p className="body-sm" style={{ marginTop: 16, maxWidth: "64ch" }}>
            A request published outwards carries the measurement, the location and the
            frequency. It does not carry the target asset, the strategy, the direction, or
            the value of the observation. The network exists to acquire observations, not
            to distribute what we learn from them.
          </p>
          <ol className="acq-steps">
            {[
              "Engine identifies a missing observation",
              "Request is abstracted from the hypothesis",
              "Contributor supplies the measurement",
              "Data returns to the private engine",
              "Value is measured internally",
              "Contributor is rewarded",
            ].map((step, i) => (
              <li key={step} className="acq-step">
                <span className="mono acq-n">{String(i + 1).padStart(2, "0")}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="meta muted" style={{ marginTop: 24, lineHeight: 1.8 }}>
            Settlement infrastructure is future work and is not part of this system.
          </p>
        </div>
      </section>

      <div style={{ marginTop: 48 }}>
        <Link to="/discovery" className="btn btn-secondary">
          Run discovery <span className="arrow">→</span>
        </Link>
      </div>
    </div>
  );
}

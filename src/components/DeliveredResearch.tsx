import { useMemo } from "react";
import { LineChart, Sparkline } from "./charts";

export type DeliveredColumn = { key: string; label: string; kind?: "signal" | "return" };
export type DeliveredRow = Record<string, string | number>;
export type Delivered = {
  package_id: string;
  title: string;
  columns: DeliveredColumn[];
  rows: DeliveredRow[];
  proof: { network: string; verified?: boolean; program_id: string; dataset_commitment: string; entitlement_pda: string; normalized_dataset_hash: string; result_hash: string };
  summary: Record<string, number | string>;
  download_url?: string;
};

/** Explorer link for a Devnet account, so an on-chain claim can be checked rather than taken on trust. */
function solscan(address: string) {
  return `https://solscan.io/account/${address}?cluster=devnet`;
}

function ProofEntry({ label, address, verified }: { label: string; address: string; verified: boolean }) {
  if (verified) return <a className="proof-link" href={solscan(address)} target="_blank" rel="noreferrer">{label} ↗</a>;
  return <span className="proof-absent" title={address}>{label} — not on Devnet ({address.slice(0, 6)}…)</span>;
}

function jsonl(item: Delivered) {
  return item.rows.map((row) => JSON.stringify(row)).join("\n");
}

/**
 * What a buyer actually paid for. Headline figures are stat tiles rather than
 * charts — a single number is not a plot — the series gets one line on one
 * axis, and the table underneath is the accessible read of the same rows.
 */
export function DeliveredResearch({ item }: { item: Delivered }) {
  const observationKey = item.columns.find((column) => !["observed_at", "available_at", "feature_z", "signal", "target_return_pct"].includes(column.key))?.key ?? "feature_z";
  const observationLabel = item.columns.find((column) => column.key === observationKey)?.label ?? observationKey;
  const values = item.rows.map((row) => Number(row[observationKey]));
  const equity = item.rows.filter((row) => Number.isFinite(Number(row.cumulative_pct))).map((row) => Number(row.cumulative_pct));
  const last = item.rows.length - 1;
  // Four evenly spaced ticks anchored to both ends. Taking every nth row and
  // then appending the last one crowds the final two labels together.
  const xLabels = last <= 0
    ? item.rows.map((row) => String(row.observed_at).slice(5))
    : [0, 1, 2, 3].map((tick) => String(item.rows[Math.round((tick / 3) * last)].observed_at).slice(5));

  // Live users download the exact authorized object; fixtures build the same
  // JSONL locally so the demo remains self-contained.
  const localDownload = useMemo(() => URL.createObjectURL(new Blob([jsonl(item)], { type: "application/x-ndjson" })), [item]);
  const download = item.download_url ?? localDownload;

  const verified = item.proof.verified === true;
  const ic = Number(item.summary.information_coefficient);
  const sharpe = Number(item.summary.sharpe_like);

  return (
    <article className="market-package">
      <p className="meta">ENTITLED / {String(item.summary.rows)} ROWS / {String(item.summary.coverage)}</p>
      <h2 className="h2">{item.title}</h2>
      <p className="body-sm">Observations are timestamped twice: when measured, and when the publisher first released them. Every statistic below is computed on the released timestamp, {String(item.summary.publication_lag_hours)}h after measurement.</p>

      <div className="stat-row">
        <div className="stat"><p className="meta">Information coefficient</p><p className="stat-value">{ic.toFixed(3)}</p></div>
        <div className="stat"><p className="meta">Sharpe-like</p><p className="stat-value">{sharpe.toFixed(2)}</p></div>
        <div className="stat"><p className="meta">Hit rate</p><p className="stat-value">{String(item.summary.hit_rate_pct)}%</p></div>
        <div className="stat"><p className="meta">Traded days</p><p className="stat-value">{String(item.summary.traded_days)}</p></div>
      </div>

      <p className="meta chart-title">{observationLabel}</p>
      <LineChart series={[{ label: observationLabel, values, tone: "primary", width: 2 }]} height={200} xLabels={xLabels} />

      <div className="stat-row stat-row-tight">
        {equity.length > 0 && <div className="stat">
          <p className="meta">Cumulative signal return %</p>
          {/* Signed: the trace is coloured by which side of zero it sits on, and
              the number is written out beside it, never colour alone. */}
          <Sparkline values={equity} width={200} height={34} signed />
          <p className="body-sm">{(equity[equity.length - 1] ?? 0) >= 0 ? "+" : ""}{equity[equity.length - 1] ?? 0}% over {String(item.summary.traded_days)} traded days</p>
        </div>}
        <div className="stat">
          <p className="meta">On-chain proof / {item.proof.network}</p>
          <p className="proof-links">
            <ProofEntry label="Registry program" address={item.proof.program_id} verified={verified} />
            <ProofEntry label="Dataset commitment" address={item.proof.dataset_commitment} verified={verified} />
            <ProofEntry label="Your entitlement" address={item.proof.entitlement_pda} verified={verified} />
          </p>
          <p className="body-sm mono-hash">result {item.proof.result_hash.slice(0, 16)}…</p>
        </div>
      </div>

      <div className="source-actions" style={{ marginTop: 18 }}>
        <a className="btn btn-secondary" href={download} download={`qarau-${item.package_id.slice(-8)}.jsonl`}>Download JSONL</a>
      </div>

      <div className="data-scroll">
        <table className="data-table">
          <caption className="sr-only">{item.title} — delivered observations</caption>
          <thead><tr>{item.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
          <tbody>
            {item.rows.slice(-14).map((row) => (
              <tr key={String(row.observed_at)}>
                {item.columns.map((column) => {
                  const cell = row[column.key];
                  if (column.kind === "signal") return <td key={column.key}><span className={`signal signal-${cell}`}>{cell}</span></td>;
                  if (column.kind === "return") return <td key={column.key}><span className={`signal signal-${Number(cell) >= 0 ? "long" : "short"}`}>{Number(cell) >= 0 ? "+" : ""}{cell}</span></td>;
                  return <td key={column.key}>{cell}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function parseJson(bytes, fallback = {}) {
  try { return JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { return fallback; }
}

function parseJsonl(bytes) {
  return Buffer.from(bytes).toString("utf8").split(/\r?\n/).filter(Boolean).slice(-240).map((line) => JSON.parse(line));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Build the entitlement-gated presentation without inventing unavailable data. */
export function buildDeliveredView({ context, grant, bytes, reportBytes, proofVerified = false }) {
  const rawRows = parseJsonl(bytes);
  const valueKeys = [...new Set(rawRows.flatMap((row) => Object.keys(row.values ?? {}).filter((key) => !["timestamp", "available_at"].includes(key))))].slice(0, 4);
  const columns = [
    { key: "observed_at", label: "Observed" },
    { key: "available_at", label: "Available" },
    ...valueKeys.map((key) => ({ key, label: key.replaceAll("_", " ") })),
  ];
  const rows = rawRows.map((row) => ({
    observed_at: row.timestamp ?? row.observed_at ?? "—",
    available_at: row.available_at ?? row.availableAt ?? row.timestamp ?? "—",
    ...Object.fromEntries(valueKeys.map((key) => [key, row.values?.[key] ?? row[key] ?? "—"])),
  }));
  const report = parseJson(reportBytes);
  const test = report.best?.validation?.splits?.find((split) => split.split === "test") ?? {};
  const coverage = rows.length ? `${rows[0].observed_at} → ${rows.at(-1).observed_at}` : "No readable observations";
  const publicationLags = rows.map((row) => (Date.parse(row.available_at) - Date.parse(row.observed_at)) / 3_600_000).filter((value) => Number.isFinite(value) && value >= 0).sort((left, right) => left - right);
  const publicationLagHours = publicationLags.length ? publicationLags[Math.floor(publicationLags.length / 2)] : 0;
  return {
    package_id: context.id,
    title: context.public_metadata?.title ?? "Delivered research",
    columns,
    rows,
    proof: {
      network: "devnet",
      verified: proofVerified === true,
      program_id: context.program_id,
      dataset_commitment: context.dataset_pda,
      entitlement_pda: grant.entitlementPda,
      normalized_dataset_hash: Buffer.from(context.normalized_dataset_hash).toString("hex"),
      result_hash: Buffer.from(context.analysis_result_hash).toString("hex"),
    },
    summary: {
      rows: rows.length,
      coverage,
      information_coefficient: finite(test.information_coefficient),
      sharpe_like: finite(test.sharpe_like),
      hit_rate_pct: finite(test.directional_accuracy) * 100,
      traded_days: finite(test.trades, rows.length),
      publication_lag_hours: publicationLagHours,
    },
    download_url: `/api/v1/dataset/${context.id}/export`,
  };
}

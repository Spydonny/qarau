/**
 * Deterministic fixtures for demo mode.
 *
 * These stand in for `/api/v1` public + wallet responses so the public
 * research and access pages stay explorable when the integrated runtime
 * (PostgreSQL + object store + Devnet signer) is not running — which is the
 * case for a plain `npm run dev`, where `/api/v1` is not mounted at all.
 */

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Stable pseudo-address per seed. It encodes exactly 32 bytes, because a
 * Solana address that decodes to any other length is rejected by every
 * explorer and RPC the page links out to.
 */
function seededBytes(seed: string, count: number) {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619) >>> 0;
  }
  const bytes = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bytes[index] = (state >>> 24) & 0xff;
  }
  return bytes;
}

function base58Encode(bytes: Uint8Array) {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) { carry += digits[index] << 8; digits[index] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = "";
  for (const byte of bytes) { if (byte !== 0) break; out += "1"; }
  for (let index = digits.length - 1; index >= 0; index -= 1) out += BASE58[digits[index]];
  return out;
}

export function demoAddress(seed: string) {
  // A leading zero byte would base58-encode to a "1" prefix and decode back to
  // 33 bytes, so the first byte is forced non-zero.
  const bytes = seededBytes(seed, 32);
  if (bytes[0] === 0) bytes[0] = 1;
  return base58Encode(bytes);
}

export function demoSignature(seed: string) {
  return base58Encode(seededBytes("sig:" + seed, 64));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function iso(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString();
}

export type DemoRound = {
  state: string;
  opens_at: string;
  closes_at: string;
  minimum_bid_lamports: number;
  max_winners: number;
  bid_count: number;
  winners_count: number;
  clearing_price_lamports: number | null;
  settlement_rule: string;
};

export type DemoPackage = {
  package_id: string;
  title: string;
  description: string;
  evidence_band: string;
  access_form: "derived_only" | "normalized_and_derived";
  update_frequency: string;
  coverage: { start: string; end: string };
  validation_summary: Record<string, unknown>;
  commitment_address: string;
  access_round_address: string;
  access_round_id: string;
  access_round: DemoRound;
};

type Seed = {
  id: string;
  title: string;
  description: string;
  evidence_band: string;
  access_form: "derived_only" | "normalized_and_derived";
  update_frequency: string;
  coverage: [string, string];
  validation: Record<string, unknown>;
  state: string;
  opens: number;
  closes: number;
  minimum: number;
  winners: number;
  bids: number;
  winnersCount: number;
  clearing: number | null;
};

/**
 * Round windows are relative to load time so the temporal state machine
 * (upcoming → live → ended) resolves the way the server's
 * effectiveAccessRoundState would resolve it.
 */
const SEEDS: Seed[] = [
  {
    id: "c0f1a7d2-4b8e-4c31-9a26-31d0a7b41e01",
    title: "Port congestion vs. dry bulk freight rates",
    description:
      "Berth occupancy and anchorage dwell time across 41 container terminals, tested against next-week dry bulk freight settlement. Survives purged walk-forward and embargoed folds.",
    evidence_band: "strong",
    access_form: "normalized_and_derived",
    update_frequency: "daily",
    coverage: ["2019-01-01", "2026-08-31"],
    validation: { horizon_days: 5, information_coefficient: 0.081, deflated_sharpe: 1.42, folds: 12, blocking_leakage: 0 },
    state: "live",
    opens: -6 * HOUR,
    closes: 30 * HOUR,
    minimum: 25_000_000,
    winners: 5,
    bids: 17,
    winnersCount: 0,
    clearing: null,
  },
  {
    id: "c0f1a7d2-4b8e-4c31-9a26-31d0a7b41e02",
    title: "Grid interconnect queue withdrawals vs. utility capex",
    description:
      "Weekly interconnection queue withdrawal counts from seven ISOs, aligned to utility capital expenditure revisions with a 14-day availability lag.",
    evidence_band: "moderate",
    access_form: "derived_only",
    update_frequency: "weekly",
    coverage: ["2020-06-01", "2026-08-24"],
    validation: { horizon_days: 21, information_coefficient: 0.047, deflated_sharpe: 0.91, folds: 9, blocking_leakage: 0 },
    state: "live",
    opens: -2 * DAY,
    closes: 9 * HOUR,
    minimum: 12_000_000,
    winners: 3,
    bids: 6,
    winnersCount: 0,
    clearing: null,
  },
  {
    id: "c0f1a7d2-4b8e-4c31-9a26-31d0a7b41e03",
    title: "Cold-chain pharmacy outages vs. specialty distributor margin",
    description:
      "Refrigeration failure incident reports from 2,300 retail pharmacy nodes, tested against quarterly specialty distributor gross margin.",
    evidence_band: "strong",
    access_form: "normalized_and_derived",
    update_frequency: "daily",
    coverage: ["2021-03-01", "2026-09-01"],
    validation: { horizon_days: 63, information_coefficient: 0.063, deflated_sharpe: 1.18, folds: 8, blocking_leakage: 0 },
    state: "upcoming",
    opens: 2 * DAY,
    closes: 5 * DAY,
    minimum: 40_000_000,
    winners: 4,
    bids: 0,
    winnersCount: 0,
    clearing: null,
  },
  {
    id: "c0f1a7d2-4b8e-4c31-9a26-31d0a7b41e04",
    title: "Rail siding idle-car counts vs. chemical producer inventories",
    description:
      "Satellite-derived idle tank-car counts at 118 chemical sidings, tested against reported producer inventory turns.",
    evidence_band: "moderate",
    access_form: "derived_only",
    update_frequency: "weekly",
    coverage: ["2018-01-01", "2026-07-31"],
    validation: { horizon_days: 42, information_coefficient: 0.039, deflated_sharpe: 0.74, folds: 10, blocking_leakage: 0 },
    state: "settled",
    opens: -9 * DAY,
    closes: -2 * DAY,
    minimum: 18_000_000,
    winners: 4,
    bids: 11,
    winnersCount: 4,
    clearing: 21_500_000,
  },
  {
    id: "c0f1a7d2-4b8e-4c31-9a26-31d0a7b41e05",
    title: "Municipal water pressure anomalies vs. regional REIT occupancy",
    description:
      "District-metered-area pressure anomalies across 63 municipalities as an occupancy proxy, tested against regional residential REIT reported occupancy.",
    evidence_band: "emerging",
    access_form: "derived_only",
    update_frequency: "monthly",
    coverage: ["2022-01-01", "2026-08-01"],
    validation: { horizon_days: 90, information_coefficient: 0.028, deflated_sharpe: 0.55, folds: 7, blocking_leakage: 0 },
    state: "access_granted",
    opens: -21 * DAY,
    closes: -14 * DAY,
    minimum: 9_000_000,
    winners: 6,
    bids: 8,
    winnersCount: 6,
    clearing: 9_000_000,
  },
  {
    id: "c0f1a7d2-4b8e-4c31-9a26-31d0a7b41e06",
    title: "Border crossing wait-time dispersion vs. cross-border trucking",
    description:
      "Hourly commercial-lane wait-time dispersion at 24 land border crossings, tested against cross-border trucking revenue per mile.",
    evidence_band: "strong",
    access_form: "normalized_and_derived",
    update_frequency: "hourly",
    coverage: ["2019-09-01", "2026-09-02"],
    validation: { horizon_days: 10, information_coefficient: 0.072, deflated_sharpe: 1.31, folds: 11, blocking_leakage: 0 },
    state: "ended",
    opens: -4 * DAY,
    closes: -40 * MINUTE,
    minimum: 30_000_000,
    winners: 5,
    bids: 14,
    winnersCount: 0,
    clearing: null,
  },
];

export function demoPackages(): DemoPackage[] {
  return SEEDS.map((seed) => ({
    package_id: seed.id,
    title: seed.title,
    description: seed.description,
    evidence_band: seed.evidence_band,
    access_form: seed.access_form,
    update_frequency: seed.update_frequency,
    coverage: { start: seed.coverage[0], end: seed.coverage[1] },
    validation_summary: seed.validation,
    commitment_address: demoAddress("dataset:" + seed.id),
    access_round_address: demoAddress("round:" + seed.id),
    access_round_id: seed.id.replace(/^c0f1/, "a11c"),
    access_round: {
      state: seed.state,
      opens_at: iso(seed.opens),
      closes_at: iso(seed.closes),
      minimum_bid_lamports: seed.minimum,
      max_winners: seed.winners,
      bid_count: seed.bids,
      winners_count: seed.winnersCount,
      clearing_price_lamports: seed.clearing,
      settlement_rule: "pay_as_bid_top_n",
    },
  }));
}

/** Bids pre-seeded for any wallet that authenticates, so positions are never empty. */
export const DEMO_SEEDED_BIDS = [
  { packageIndex: 3, amount_lamports: 24_000_000, tier: "exclusive_early", status: "won", placedOffsetMs: -3 * DAY },
  { packageIndex: 4, amount_lamports: 9_500_000, tier: "delayed", status: "claimed", placedOffsetMs: -16 * DAY },
  { packageIndex: 0, amount_lamports: 27_500_000, tier: "exclusive_early", status: "placed", placedOffsetMs: -4 * HOUR },
  { packageIndex: 5, amount_lamports: 28_000_000, tier: "delayed", status: "placed", placedOffsetMs: -2 * DAY },
];

export type DeliveredColumn = { key: string; label: string; kind?: "signal" | "return" };

/**
 * Deterministic per-package research rows. The observation columns follow the
 * package's own subject, and every row carries `available_at` — the timestamp
 * the observation could first have been known — because that lag is the whole
 * basis of the leakage-safe claim being sold.
 */
export function demoDataset(packageId: string, title: string, commitmentAddress: string, entitlementPda: string) {
  const bytes = seededBytes("dataset:" + packageId, 512);
  let cursor = 0;
  const next = () => { const value = ((bytes[cursor % bytes.length] << 8) | bytes[(cursor + 1) % bytes.length]) / 65535; cursor += 2; return value; };
  const gauss = () => { const a = Math.max(next(), 1e-6); const b = next(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); };

  const subject = /traffic camera/i.test(title) ? "cameras" : /traffic/i.test(title) ? "traffic" : /road weather/i.test(title) ? "road" : "weather";
  const observationColumns: Record<string, DeliveredColumn[]> = {
    weather: [{ key: "air_temp_c", label: "Air temp °C" }, { key: "wind_kph", label: "Wind kph" }, { key: "precip_mm", label: "Precip mm" }],
    road: [{ key: "surface_temp_c", label: "Surface °C" }, { key: "friction_index", label: "Friction" }, { key: "stations_reporting", label: "Stations" }],
    traffic: [{ key: "incident_count", label: "Incidents" }, { key: "avg_delay_min", label: "Avg delay min" }, { key: "arterials_affected", label: "Arterials" }],
    cameras: [{ key: "cameras_online", label: "Cameras online" }, { key: "uptime_pct", label: "Uptime %" }, { key: "coverage_km2", label: "Coverage km²" }],
  };
  const columns: DeliveredColumn[] = [
    { key: "observed_at", label: "Observed" },
    { key: "available_at", label: "Available" },
    ...observationColumns[subject],
    { key: "feature_z", label: "Feature z" },
    { key: "signal", label: "Signal", kind: "signal" },
    { key: "target_return_pct", label: "BTC-USD t+1 %", kind: "return" },
  ];

  const rows: Array<Record<string, string | number>> = [];
  let level = subject === "weather" ? 14 + next() * 8 : subject === "road" ? 6 + next() * 6 : subject === "traffic" ? 18 + next() * 10 : 240 + next() * 30;
  let hits = 0;
  let cumulative = 0;
  const days = 45;
  for (let index = days - 1; index >= 0; index -= 1) {
    const observedAt = new Date(Date.now() - index * 86_400_000);
    // Publication lag: the row is only usable once the publisher released it.
    const availableAt = new Date(observedAt.getTime() + (subject === "traffic" ? 6 : 18) * 3_600_000);
    level = level + gauss() * (subject === "cameras" ? 4 : 1.6);
    const featureZ = gauss();
    const signal = featureZ > 0.75 ? "long" : featureZ < -0.75 ? "short" : "flat";
    // The target keeps a weak, honest relationship with the feature — an IC in
    // the low single digits, not a curve that would never survive validation.
    const targetReturn = 0.18 * featureZ + gauss() * 2.4;
    if (signal !== "flat" && Math.sign(targetReturn) === Math.sign(featureZ)) hits += 1;
    if (signal !== "flat") cumulative += signal === "long" ? targetReturn : -targetReturn;

    const observation: Record<string, number> = subject === "weather"
      ? { air_temp_c: Number(level.toFixed(1)), wind_kph: Number((6 + Math.abs(gauss()) * 9).toFixed(1)), precip_mm: Number(Math.max(0, gauss() * 3).toFixed(1)) }
      : subject === "road"
        ? { surface_temp_c: Number(level.toFixed(1)), friction_index: Number((0.55 + next() * 0.35).toFixed(3)), stations_reporting: 38 + Math.round(next() * 6) }
        : subject === "traffic"
          ? { incident_count: Math.max(0, Math.round(level)), avg_delay_min: Number((4 + Math.abs(gauss()) * 5).toFixed(1)), arterials_affected: 3 + Math.round(next() * 9) }
          : { cameras_online: Math.max(0, Math.round(level)), uptime_pct: Number((94 + next() * 5.6).toFixed(2)), coverage_km2: Number((110 + next() * 40).toFixed(1)) };

    rows.push({
      observed_at: observedAt.toISOString().slice(0, 10),
      available_at: availableAt.toISOString().slice(0, 16).replace("T", " "),
      ...observation,
      feature_z: Number(featureZ.toFixed(3)),
      signal,
      target_return_pct: Number(targetReturn.toFixed(2)),
      cumulative_pct: Number(cumulative.toFixed(2)),
    });
  }

  const traded = rows.filter((row) => row.signal !== "flat").length;
  const returns = rows.map((row) => Number(row.target_return_pct));
  const features = rows.map((row) => Number(row.feature_z));
  const meanReturn = returns.reduce((total, value) => total + value, 0) / returns.length;
  const meanFeature = features.reduce((total, value) => total + value, 0) / features.length;
  let covariance = 0;
  let varianceF = 0;
  let varianceR = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const df = features[index] - meanFeature;
    const dr = returns[index] - meanReturn;
    covariance += df * dr; varianceF += df * df; varianceR += dr * dr;
  }
  const ic = covariance / Math.sqrt((varianceF || 1) * (varianceR || 1));
  const daily = rows.filter((row) => row.signal !== "flat").map((row) => (row.signal === "long" ? 1 : -1) * Number(row.target_return_pct));
  const meanDaily = daily.reduce((total, value) => total + value, 0) / (daily.length || 1);
  const sd = Math.sqrt(daily.reduce((total, value) => total + (value - meanDaily) ** 2, 0) / (daily.length || 1)) || 1;

  return {
    package_id: packageId,
    title,
    columns,
    rows,
    proof: {
      network: "devnet",
      verified: false,
      program_id: "63VZwKUPcWqo2JwpQHLxT4HHgQsMREpERZg3DpfSnnMw",
      dataset_commitment: commitmentAddress,
      entitlement_pda: entitlementPda,
      normalized_dataset_hash: base58Encode(seededBytes("normalized:" + packageId, 32)),
      result_hash: base58Encode(seededBytes("result:" + packageId, 32)),
    },
    summary: {
      rows: rows.length,
      coverage: `${rows[0].observed_at} → ${rows[rows.length - 1].observed_at}`,
      information_coefficient: Number(ic.toFixed(3)),
      sharpe_like: Number(((meanDaily / sd) * Math.sqrt(252)).toFixed(2)),
      hit_rate_pct: Number(((hits / (traded || 1)) * 100).toFixed(1)),
      traded_days: traded,
      publication_lag_hours: subject === "traffic" ? 6 : 18,
    },
  };
}

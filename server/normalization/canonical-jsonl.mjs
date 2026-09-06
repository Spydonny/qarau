import { HASH_DOMAINS, canonicalDecimal, canonicalJsonlBytes, hashBytes } from "../domain/canonical-artifacts.mjs";

function iso(value, label) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`invalid_${label}`);
  return new Date(time).toISOString();
}

function decimal(value) {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("invalid_normalized_value");
  const rendered = typeof value === "number" ? String(value) : String(value).trim();
  if (/e/i.test(rendered)) throw new Error("exponent_not_allowed_in_normalized_value");
  return canonicalDecimal(rendered);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function frequency(timestamps) {
  if (timestamps.length < 3) return { label: "IRREGULAR", continuity: 0, median_interval_seconds: null };
  const intervals = timestamps.slice(1).map((value, index) => (Date.parse(value) - Date.parse(timestamps[index])) / 1_000).filter((value) => value > 0);
  const typical = median(intervals);
  const continuity = intervals.filter((value) => Math.abs(value - typical) <= Math.max(1, typical * .25)).length / intervals.length;
  const label = typical <= 5 * 60 ? "MINUTELY" : typical <= 90 * 60 ? "HOURLY" : typical <= 36 * 60 * 60 ? "DAILY" : typical <= 9 * 86_400 ? "WEEKLY" : typical <= 45 * 86_400 ? "MONTHLY" : typical <= 400 * 86_400 ? "ANNUAL" : "IRREGULAR";
  return { label, continuity, median_interval_seconds: typical };
}

function outlierRate(rows, fields) {
  let observed = 0;
  let outliers = 0;
  for (const field of fields) {
    const values = rows.map((row) => Number(row.values[field])).filter(Number.isFinite);
    if (values.length < 4) { observed += values.length; continue; }
    const sorted = [...values].sort((left, right) => left - right);
    const q1 = sorted[Math.floor((sorted.length - 1) * .25)];
    const q3 = sorted[Math.floor((sorted.length - 1) * .75)];
    const iqr = q3 - q1;
    const low = q1 - 1.5 * iqr;
    const high = q3 + 1.5 * iqr;
    observed += values.length;
    outliers += values.filter((value) => value < low || value > high).length;
  }
  return observed ? outliers / observed : 0;
}

/** Normalize a provider's time series into commitment-ready, canonical JSONL. */
export function normalizeRows(rows, { valueField = "value", valueFields = null, normalizerVersion = "1" } = {}) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500_000) throw new Error("invalid_normalization_rows");
  if (!/^[a-z0-9._-]{1,64}$/i.test(valueField) || !/^[a-z0-9._-]{1,64}$/i.test(normalizerVersion)) throw new Error("invalid_normalizer_metadata");
  const requestedFields = valueFields === null ? null : [...new Set(valueFields)];
  if (requestedFields && (!requestedFields.length || requestedFields.some((field) => typeof field !== "string" || !/^[a-z0-9._-]{1,64}$/i.test(field)))) throw new Error("invalid_normalizer_metadata");
  const candidates = rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("invalid_normalization_row");
    const timestamp = iso(row.timestamp, "normalization_timestamp");
    const availableAt = iso(row.availableAt ?? row.available_at ?? row.timestamp, "availability_timestamp");
    if (Date.parse(availableAt) < Date.parse(timestamp)) throw new Error("invalid_normalization_timeline");
    const supplied = row.values && typeof row.values === "object" && !Array.isArray(row.values) ? row.values : row;
    const fields = requestedFields ?? Object.keys(supplied).filter((field) => !["timestamp", "availableAt", "available_at", "values"].includes(field) && /^[a-z0-9._-]{1,64}$/i.test(field));
    const values = Object.fromEntries(fields.filter((field) => supplied[field] !== null && supplied[field] !== undefined && String(supplied[field]).trim() !== "").map((field) => [field, decimal(supplied[field])]));
    if (!Object.keys(values).length) throw new Error("normalization_row_has_no_values");
    return { row: { available_at: availableAt, timestamp, values }, index };
  });
  const duplicateCount = candidates.length - new Set(candidates.map(({ row }) => row.timestamp)).size;
  // The raw snapshot remains authoritative. For the normalized analytic view,
  // retain the final observation for a timestamp and record the duplicate rate.
  const normalized = [...new Map(candidates.sort((left, right) => left.row.timestamp.localeCompare(right.row.timestamp) || left.index - right.index).map(({ row }) => [row.timestamp, row])).values()];
  const fields = [...new Set(normalized.flatMap((row) => Object.keys(row.values)))].sort();
  const totalCells = normalized.length * fields.length;
  const presentCells = normalized.reduce((total, row) => total + Object.keys(row.values).length, 0);
  const cadence = frequency(normalized.map((row) => row.timestamp));
  const quality = Object.freeze({
    observations: normalized.length,
    fields,
    missing_rate: totalCells ? (totalCells - presentCells) / totalCells : 0,
    duplicate_rate: duplicateCount / rows.length,
    outlier_rate: outlierRate(normalized, fields),
    continuity: cadence.continuity,
    frequency: cadence.label,
    median_interval_seconds: cadence.median_interval_seconds,
    coverage_start: normalized[0].timestamp,
    coverage_end: normalized.at(-1).timestamp,
  });
  const bytes = canonicalJsonlBytes(normalized);
  return Object.freeze({ rows: Object.freeze(normalized), bytes, hash: hashBytes(HASH_DOMAINS.normalizedDataset, bytes), normalizerVersion, quality });
}

function rowFingerprint(row) {
  return JSON.stringify(row);
}

/** Exact record comparison; prior normalized bytes are never mutated. */
export function diffNormalizedRows(previousRows, nextRows) {
  if (!previousRows) return Object.freeze({ changeType: "initial", added: nextRows.length, changed: 0, unchanged: 0 });
  const prior = new Map(previousRows.map((row) => [row.timestamp, rowFingerprint(row)]));
  let added = 0;
  let changed = 0;
  let unchanged = 0;
  for (const row of nextRows) {
    const before = prior.get(row.timestamp);
    if (before === undefined) added += 1;
    else if (before === rowFingerprint(row)) unchanged += 1;
    else changed += 1;
  }
  const changeType = added === 0 && changed === 0 ? "no_change" : changed > 0 ? "changed_records" : "new_records";
  return Object.freeze({ changeType, added, changed, unchanged });
}

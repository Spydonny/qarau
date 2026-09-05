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

/** Normalize a provider's time series into commitment-ready, canonical JSONL. */
export function normalizeRows(rows, { valueField = "value", normalizerVersion = "1" } = {}) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500_000) throw new Error("invalid_normalization_rows");
  if (!/^[a-z0-9._-]{1,64}$/i.test(valueField) || !/^[a-z0-9._-]{1,64}$/i.test(normalizerVersion)) throw new Error("invalid_normalizer_metadata");
  const seen = new Set();
  const normalized = rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("invalid_normalization_row");
    const timestamp = iso(row.timestamp, "normalization_timestamp");
    const availableAt = iso(row.availableAt ?? row.available_at ?? row.timestamp, "availability_timestamp");
    if (Date.parse(availableAt) < Date.parse(timestamp) || seen.has(timestamp)) throw new Error("invalid_normalization_timeline");
    seen.add(timestamp);
    return { available_at: availableAt, timestamp, values: { [valueField]: decimal(row[valueField]) } };
  }).sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const bytes = canonicalJsonlBytes(normalized);
  return Object.freeze({ rows: Object.freeze(normalized), bytes, hash: hashBytes(HASH_DOMAINS.normalizedDataset, bytes), normalizerVersion });
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

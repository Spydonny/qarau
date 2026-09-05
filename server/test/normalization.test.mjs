import assert from "node:assert/strict";
import test from "node:test";
import { diffNormalizedRows, normalizeRows } from "../normalization/canonical-jsonl.mjs";

const input = [
  { timestamp: "2025-01-02", availableAt: "2025-01-04", value: 2.5 },
  { timestamp: "2025-01-01", availableAt: "2025-01-03", value: 1 },
];

test("normalization writes sorted canonical JSONL with a commitment hash", () => {
  const normalized = normalizeRows(input);
  assert.equal(normalized.rows[0].timestamp, "2025-01-01T00:00:00.000Z");
  assert.equal(normalized.rows[0].values.value, "1");
  assert.equal(normalized.bytes.toString("utf8").endsWith("\n"), true);
  assert.match(normalized.hash, /^[0-9a-f]{64}$/);
  assert.throws(() => normalizeRows([{ timestamp: "2025-01-01", value: 1e-7 }]), /exponent_not_allowed/);
});

test("normalization distinguishes initial, no-change, new and changed records", () => {
  const first = normalizeRows(input).rows;
  assert.equal(diffNormalizedRows(null, first).changeType, "initial");
  assert.equal(diffNormalizedRows(first, first).changeType, "no_change");
  assert.equal(diffNormalizedRows(first, [...first, { timestamp: "2025-01-03T00:00:00.000Z", available_at: "2025-01-05T00:00:00.000Z", values: { value: "3" } }]).changeType, "new_records");
  assert.equal(diffNormalizedRows(first, [{ ...first[0], values: { value: "99" } }, first[1]]).changeType, "changed_records");
});

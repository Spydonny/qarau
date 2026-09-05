import assert from "node:assert/strict";
import test from "node:test";
import { runAlphaTest } from "../lib/alpha-lab.mjs";

test("alpha lab excludes observations unavailable at prediction time", () => {
  const source = Array.from({ length: 48 }, (_, index) => ({
    timestamp: `2025-01-${String(index + 1).padStart(2, "0")}`,
    value: index,
    availableAt: `2025-02-${String(index + 1).padStart(2, "0")}`,
  }));
  const target = source.map((row, index) => ({ timestamp: row.timestamp, price: 100 + index }));
  assert.throws(() => runAlphaTest({ source, target, lag: 1 }));
});

test("alpha lab reports non-parametric diagnostics and walk-forward stability", () => {
  const start = Date.UTC(2024, 0, 1);
  const source = Array.from({ length: 240 }, (_, index) => {
    const timestamp = new Date(start + index * 86_400_000).toISOString();
    return { timestamp, availableAt: timestamp, value: Math.sin(index / 9) + index / 200 };
  });
  let price = 100;
  const target = source.map((row, index) => {
    price *= 1 + (index > 2 ? source[index - 2].value * 0.001 : 0);
    return { timestamp: row.timestamp, price };
  });
  const result = runAlphaTest({ source, target, lag: 2, horizon: 1 });
  assert.equal(result.folds.length, 3);
  assert.ok(result.correlationByLag.every((item) => Number.isFinite(item.spearman)));
  assert.ok(Number.isFinite(result.mutualInformation));
  assert.ok(Number.isFinite(result.crossCorrelation));
  assert.ok(result.stabilityAcrossFolds >= 0 && result.stabilityAcrossFolds <= 1);
});

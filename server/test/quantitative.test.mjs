import assert from "node:assert/strict";
import test from "node:test";
import { constructSignals, runQuantitativeAnalysis } from "../analysis/quantitative.mjs";

function fixture() {
  const start = Date.UTC(2024, 0, 1);
  const normalizedRows = Array.from({ length: 240 }, (_, index) => ({ timestamp: new Date(start + index * 86_400_000).toISOString(), available_at: new Date(start + index * 86_400_000).toISOString(), values: { flow: String(Math.sin(index / 7) + index / 500) } }));
  let price = 100;
  const marketRows = normalizedRows.map((row, index) => { price *= 1 + (index > 3 ? Number(normalizedRows[index - 3].values.flow) * .001 : 0); return { timestamp: row.timestamp, price }; });
  return { normalizedRows, marketRows };
}

test("constructs all required transformed signal families", () => {
  const { normalizedRows } = fixture();
  const transformations = new Set(constructSignals(normalizedRows).map((item) => item.transformation));
  for (const name of ["raw", "percent_change", "delta_change", "rolling_zscore", "rolling_average_deviation"]) assert.ok(transformations.has(name));
});

test("runs chronological validation, regimes, leakage checks, and a deterministic score", () => {
  const { normalizedRows, marketRows } = fixture();
  const result = runQuantitativeAnalysis({ normalizedRows, marketRows, quality: { missing_rate: 0, outlier_rate: 0 }, settings: { horizons: [1], lags: [0, 3], rollingWindows: [7] } });
  assert.ok(result.evaluationCount > 0);
  const evaluated = result.evaluations.find((item) => item.validation);
  assert.ok(evaluated);
  assert.deepEqual(evaluated.validation.splits.map((item) => item.split), ["train", "validation", "test"]);
  assert.equal(evaluated.validation.regimes.length, 3);
  assert.equal(evaluated.checks.length, 6);
  assert.ok(evaluated.alpha.score >= 0 && evaluated.alpha.score <= 100);
});

import { createHash } from "node:crypto";

const DEFAULTS = Object.freeze({ horizons: [1, 3, 7], lags: [0, 1, 3, 7], rollingWindows: [7, 14], minimumObservations: 60 });

function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function deviation(values) { return Math.sqrt(mean(values.map((value) => (value - mean(values)) ** 2))); }
function correlation(left, right) {
  if (left.length < 3 || left.length !== right.length) return 0;
  const a = mean(left); const b = mean(right);
  let numerator = 0; let one = 0; let two = 0;
  for (let index = 0; index < left.length; index += 1) { const x = left[index] - a; const y = right[index] - b; numerator += x * y; one += x * x; two += y * y; }
  return one && two ? numerator / Math.sqrt(one * two) : 0;
}
function ranks(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((left, right) => left.value - right.value);
  const output = Array(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1; while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1;
    const rank = (start + end - 1) / 2 + 1;
    for (let index = start; index < end; index += 1) output[sorted[index].index] = rank;
    start = end;
  }
  return output;
}
function spearman(left, right) { return correlation(ranks(left), ranks(right)); }
function mutualInformation(left, right, bins = 8) {
  if (left.length < 8) return 0;
  const minLeft = Math.min(...left); const maxLeft = Math.max(...left); const minRight = Math.min(...right); const maxRight = Math.max(...right);
  if (minLeft === maxLeft || minRight === maxRight) return 0;
  const joint = Array.from({ length: bins }, () => Array(bins).fill(0)); const a = Array(bins).fill(0); const b = Array(bins).fill(0);
  const bucket = (value, min, max) => Math.min(bins - 1, Math.floor((value - min) / (max - min) * bins));
  for (let index = 0; index < left.length; index += 1) { const x = bucket(left[index], minLeft, maxLeft); const y = bucket(right[index], minRight, maxRight); joint[x][y] += 1; a[x] += 1; b[y] += 1; }
  let result = 0;
  for (let x = 0; x < bins; x += 1) for (let y = 0; y < bins; y += 1) if (joint[x][y]) { const p = joint[x][y] / left.length; result += p * Math.log(p / ((a[x] / left.length) * (b[y] / left.length))); }
  return result;
}
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }

function rolling(values, index, window) { return values.slice(Math.max(0, index - window + 1), index + 1); }

/** Makes durable, interpretable signal series from every numeric source field. */
export function constructSignals(normalizedRows, { rollingWindows = DEFAULTS.rollingWindows } = {}) {
  const fields = [...new Set(normalizedRows.flatMap((row) => Object.keys(row.values ?? {})))].sort();
  const result = [];
  for (const field of fields) {
    const source = normalizedRows.map((row) => ({ timestamp: row.timestamp, availableAt: row.available_at ?? row.availableAt ?? row.timestamp, availableAtInferred: Boolean(row.availableAtInferred ?? row.available_at_inferred ?? !(row.available_at ?? row.availableAt)), value: finite(row.values?.[field]) }));
    const usable = source.filter((row) => row.value !== null);
    if (usable.length < 3) continue;
    const maxAvailableAt = (indices) => {
      let latest = 0;
      let latestIso = null;
      let inferred = false;
      for (const i of indices) {
        const t = Date.parse(usable[i]?.availableAt ?? usable[i]?.timestamp);
        if (usable[i]?.availableAtInferred) inferred = true;
        if (Number.isFinite(t) && t >= latest) { latest = t; latestIso = usable[i].availableAt ?? usable[i].timestamp; }
      }
      // Any inferred input poisons the derived timestamp: unknown delay is explicit, never silently instant.
      return { iso: latestIso, inferred };
    };
    const push = (transformation, window, valueAt, windowForAvailability) => {
      const rows = usable.flatMap((row, index) => {
        const value = valueAt(index);
        if (!Number.isFinite(value)) return [];
        const inputs = typeof windowForAvailability === "function" ? windowForAvailability(index) : [index];
        const availability = maxAvailableAt(inputs);
        return [{ timestamp: row.timestamp, availableAt: availability.iso ?? row.availableAt, availableAtInferred: availability.inferred, value }];
      });
      if (rows.length >= 3) result.push(Object.freeze({ field, transformation, window, rows: Object.freeze(rows), semanticFingerprint: hash({ field, transformation, window }) }));
    };
    push("raw", null, (index) => usable[index].value, (index) => [index]);
    push("percent_change", 1, (index) => index && usable[index - 1].value !== 0 ? usable[index].value / usable[index - 1].value - 1 : NaN, (index) => [index - 1, index]);
    push("delta_change", 1, (index) => index ? usable[index].value - usable[index - 1].value : NaN, (index) => [index - 1, index]);
    for (const window of rollingWindows) {
      const winIdx = (index) => Array.from({ length: window }, (_, k) => index - window + 1 + k).filter((i) => i >= 0);
      push("rolling_zscore", window, (index) => {
        const values = rolling(usable.map((row) => row.value), index, window);
        const spread = deviation(values);
        return values.length === window && spread ? (usable[index].value - mean(values)) / spread : NaN;
      }, winIdx);
      push("rolling_average_deviation", window, (index) => {
        const values = rolling(usable.map((row) => row.value), index, window); const average = mean(values);
        return values.length === window && average ? (usable[index].value - average) / Math.abs(average) : NaN;
      }, winIdx);
    }
  }
  return Object.freeze(result);
}

function samples(signalRows, marketRows, lag, horizon) {
  const source = new Map(signalRows.map((row) => [Date.parse(row.timestamp), row]));
  const sorted = [...marketRows].map((row) => ({ timestamp: Date.parse(row.timestamp), price: finite(row.price) })).filter((row) => Number.isFinite(row.timestamp) && row.price !== null && row.price > 0).sort((left, right) => left.timestamp - right.timestamp);
  const values = [];
  let availabilityViolations = 0;
  for (let index = 1; index + horizon < sorted.length; index += 1) {
    const feature = source.get(sorted[index - lag]?.timestamp);
    if (!feature) continue;
    if (Date.parse(feature.availableAt) > sorted[index].timestamp) { availabilityViolations += 1; continue; }
    values.push({ timestamp: sorted[index].timestamp, signal: feature.value, forwardReturn: sorted[index + horizon].price / sorted[index].price - 1 });
  }
  return { values, availabilityViolations };
}

function strategyMetrics(rows, sign, thresholdMedian = null) {
  if (!rows.length) return { information_coefficient: 0, directional_accuracy: 0, return_spread: 0, sharpe_like: 0, max_drawdown: 0, observations: 0, trades: 0, stability: 0, sign: 0 };
  const signals = rows.map((row) => row.signal); const returns = rows.map((row) => row.forwardReturn);
  const ic = correlation(signals, returns) * sign;
  const medianSignal = thresholdMedian ?? median(signals);
  const positions = signals.map((value) => Math.sign((value - medianSignal) * sign));
  const pnl = positions.map((position, index) => position * returns[index]);
  let peak = 1; let value = 1; let drawdown = 0;
  for (const change of pnl) { value *= 1 + change; peak = Math.max(peak, value); drawdown = Math.min(drawdown, value / peak - 1); }
  const low = returns.filter((_value, index) => signals[index] <= medianSignal);
  const high = returns.filter((_value, index) => signals[index] > medianSignal);
  const volatility = deviation(pnl);
  return {
    information_coefficient: ic,
    directional_accuracy: positions.filter((position, index) => position && Math.sign(returns[index]) === position).length / rows.length,
    return_spread: mean(high) - mean(low),
    sharpe_like: volatility ? mean(pnl) / volatility * Math.sqrt(252) : 0,
    max_drawdown: drawdown,
    observations: rows.length,
    trades: positions.filter(Boolean).length,
    stability: Math.max(0, Math.min(1, Math.abs(ic))),
    sign,
  };
}
function median(values) { const sorted = [...values].sort((left, right) => left - right); return sorted[Math.floor(sorted.length / 2)] ?? 0; }

function validation(sampleRows, horizon = 1) {
  const purge = Math.max(0, Number(horizon) || 0);
  const trainEnd = Math.floor(sampleRows.length * .6);
  const validationEnd = Math.floor(sampleRows.length * .8);
  // Purge forward-label overlap at split boundaries: labels with horizon>1 span intervals.
  const train = sampleRows.slice(0, Math.max(0, trainEnd - purge));
  const validationRows = sampleRows.slice(trainEnd + purge, Math.max(trainEnd + purge, validationEnd - purge));
  const testRows = sampleRows.slice(validationEnd + purge);
  const orientation = Math.sign(correlation(train.map((row) => row.signal), train.map((row) => row.forwardReturn))) || 1;
  const thresholdMedian = median(train.map((row) => row.signal));
  const splits = [
    { split: "train", rows: train },
    { split: "validation", rows: validationRows },
    { split: "test", rows: testRows },
  ].map(({ split, rows }) => ({ split, ...strategyMetrics(rows, orientation, thresholdMedian) }));
  // Regimes measure stability on train/validation only: the holdout must never influence selection.
  const selectionRows = [...train, ...validationRows];
  const regimes = Array.from({ length: 3 }, (_, index) => {
    const start = Math.floor(selectionRows.length * index / 3); const end = Math.floor(selectionRows.length * (index + 1) / 3);
    return { split: "regime", regime_name: `period_${index + 1}`, ...strategyMetrics(selectionRows.slice(start, end), orientation, thresholdMedian) };
  });
  const signs = regimes.map((item) => item.sign * Math.sign(item.information_coefficient)).filter(Boolean);
  const robustness = signs.length ? signs.filter((value) => value === signs[0]).length / signs.length * mean(regimes.map((item) => Math.min(1, Math.abs(item.information_coefficient) * 4))) : 0;
  const selectionCorrelation = Math.abs(correlation(selectionRows.map((row) => row.signal), selectionRows.map((row) => row.forwardReturn)) || 0);
  return { splits, regimes, robustness, orientation, selectionCorrelation };
}

function pValue(correlationValue, count) { return Math.max(0, Math.min(1, Math.exp(-Math.abs(correlationValue) * Math.sqrt(Math.max(count - 2, 0))))); }

export function evaluateSignal({ signal, marketRows, lag, horizon, quality = {} }) {
  const aligned = samples(signal.rows, marketRows, lag, horizon);
  const rows = aligned.values;
  const x = rows.map((row) => row.signal); const y = rows.map((row) => row.forwardReturn);
  const pearson = correlation(x, y);
  const screening = Object.freeze({ pearson, spearman: spearman(x, y), mutual_information: mutualInformation(x, y), lagged_correlation: pearson, sample_size: rows.length, p_value: pValue(pearson, rows.length), q_value: pValue(pearson, rows.length) });
  const checks = [
    { check_type: "look_ahead", status: aligned.availabilityViolations ? "block" : "pass", score_penalty: aligned.availabilityViolations ? 60 : 0, explanation: aligned.availabilityViolations ? "Rows published after the decision timestamp were excluded." : "All retained observations were available at decision time." },
    { check_type: "timestamp_alignment", status: rows.length ? "pass" : "block", score_penalty: rows.length ? 0 : 60, explanation: rows.length ? "Source and market observations align chronologically." : "No timestamps could be aligned with the market series." },
    { check_type: "sample_size", status: rows.length >= DEFAULTS.minimumObservations ? "pass" : rows.length >= 30 ? "warn" : "block", score_penalty: rows.length >= DEFAULTS.minimumObservations ? 0 : rows.length >= 30 ? 12 : 45, explanation: `${rows.length} leakage-safe observations.` },
    { check_type: "instantaneous_strength", status: Math.abs(pearson) > .95 ? "block" : Math.abs(pearson) > .75 ? "warn" : "pass", score_penalty: Math.abs(pearson) > .95 ? 60 : Math.abs(pearson) > .75 ? 12 : 0, explanation: `Forward correlation is ${pearson.toFixed(4)}.` },
    { check_type: "duplicate_information", status: signal.transformation === "raw" ? "warn" : "pass", score_penalty: signal.transformation === "raw" ? 2 : 0, explanation: signal.transformation === "raw" ? "Raw signal is retained as a baseline and cannot alone receive a premium score." : "Derived transformation is evaluated independently." },
    { check_type: "missingness_stability", status: Number(quality.missing_rate ?? 0) > .25 ? "warn" : "pass", score_penalty: Number(quality.missing_rate ?? 0) > .25 ? 12 : 0, explanation: `Normalized missing rate is ${(Number(quality.missing_rate ?? 0) * 100).toFixed(2)}%.` },
  ];
  if (rows.length < 30) return Object.freeze({ signal, lag, horizon, screening, checks, validation: null, alpha: { score: 0, components: [], blocking: true }, selectionScore: 0 });
  const result = validation(rows, horizon);
  const test = result.splits.find((item) => item.split === "test");
  const leakagePenalty = checks.reduce((sum, check) => sum + check.score_penalty, 0);
  const components = [
    { component: "data_quality", raw_value: 1 - Number(quality.missing_rate ?? 0), normalized_score: Math.max(0, Math.min(100, (1 - Number(quality.missing_rate ?? 0) - Number(quality.outlier_rate ?? 0)) * 100)), weight: .2, penalty: 0, explanation: "Completeness and outlier profile of the frozen dataset version." },
    { component: "predictive_strength", raw_value: Math.abs(pearson), normalized_score: Math.min(100, Math.abs(pearson) * 300), weight: .2, penalty: 0, explanation: "Forward, not instantaneous, relationship strength." },
    { component: "out_of_sample", raw_value: test.information_coefficient, normalized_score: Math.max(0, Math.min(100, (test.information_coefficient + .1) * 400)), weight: .3, penalty: 0, explanation: "Chronological holdout IC and directionality." },
    { component: "robustness", raw_value: result.robustness, normalized_score: result.robustness * 100, weight: .2, penalty: 0, explanation: "Sign and strength consistency across three temporal regimes." },
    { component: "freshness", raw_value: 1, normalized_score: 100, weight: .1, penalty: 0, explanation: "Latest sealed source version evaluated at run time." },
  ];
  const blocking = checks.some((check) => check.status === "block");
  const score = blocking ? 0 : Math.max(0, Math.min(100, components.reduce((sum, item) => sum + item.normalized_score * item.weight, 0) - leakagePenalty));
  // Selection must not see the holdout: rank configs on train/validation only (purge-aware).
  const selectionScore = blocking ? 0 : Math.max(0, (components.find((c) => c.component === "data_quality").normalized_score * .25 + Math.min(100, result.selectionCorrelation * 300) * .35 + result.robustness * 100 * .3 + 100 * .1) - leakagePenalty);
  return Object.freeze({ signal, lag, horizon, screening, checks, validation: result, alpha: { score, components, leakagePenalty, blocking }, selectionScore });
}

/** Executes all transformations × requested lags × horizons deterministically. */
export function runQuantitativeAnalysis({ normalizedRows, marketRows, quality = {}, settings = {} }) {
  const options = { ...DEFAULTS, ...settings };
  const signals = constructSignals(normalizedRows, options);
  const rawEvals = signals.flatMap((signal) => options.horizons.flatMap((horizon) => options.lags.map((lag) => evaluateSignal({ signal, marketRows, lag, horizon, quality }))));
  const n = Math.max(1, rawEvals.length);
  const evaluations = rawEvals.map((item) => Object.freeze({ ...item, screening: Object.freeze({ ...item.screening, q_value: Math.max(0, Math.min(1, item.screening.p_value * n)) }) }));
  const eligible = evaluations.filter((item) => !item.alpha.blocking && item.validation);
  const best = [...eligible].sort((left, right) => (right.selectionScore ?? right.alpha.score) - (left.selectionScore ?? left.alpha.score))[0] ?? null;
  return Object.freeze({ pipelineVersion: "quantitative-v2", settings: options, signalCount: signals.length, evaluationCount: evaluations.length, evaluations: Object.freeze(evaluations), best });
}

export const quantitativeInternals = Object.freeze({ correlation, spearman, mutualInformation });

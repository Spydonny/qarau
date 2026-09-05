function finite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`invalid_${name}`);
  return number;
}

function time(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("invalid_timestamp");
  return parsed;
}

function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }

function correlation(a, b) {
  if (a.length < 3 || a.length !== b.length) return 0;
  const meanA = mean(a); const meanB = mean(b);
  let numerator = 0; let left = 0; let right = 0;
  for (let index = 0; index < a.length; index += 1) {
    const da = a[index] - meanA; const db = b[index] - meanB;
    numerator += da * db; left += da * da; right += db * db;
  }
  return left && right ? numerator / Math.sqrt(left * right) : 0;
}

function ranks(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = Array(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1;
    const rank = (start + end - 1) / 2 + 1;
    for (let index = start; index < end; index += 1) result[sorted[index].index] = rank;
    start = end;
  }
  return result;
}

function spearman(a, b) { return correlation(ranks(a), ranks(b)); }

function mutualInformation(a, b, bins = 8) {
  if (a.length < 8) return 0;
  const bounds = (values) => ({ min: Math.min(...values), max: Math.max(...values) });
  const left = bounds(a); const right = bounds(b);
  if (left.min === left.max || right.min === right.max) return 0;
  const joint = Array.from({ length: bins }, () => Array(bins).fill(0));
  const marginalA = Array(bins).fill(0); const marginalB = Array(bins).fill(0);
  const bucket = (value, range) => Math.min(bins - 1, Math.floor((value - range.min) / (range.max - range.min) * bins));
  for (let index = 0; index < a.length; index += 1) { const x = bucket(a[index], left); const y = bucket(b[index], right); joint[x][y] += 1; marginalA[x] += 1; marginalB[y] += 1; }
  let information = 0;
  for (let x = 0; x < bins; x += 1) for (let y = 0; y < bins; y += 1) if (joint[x][y]) {
    const pxy = joint[x][y] / a.length; const px = marginalA[x] / a.length; const py = marginalB[y] / a.length;
    information += pxy * Math.log(pxy / (px * py));
  }
  return information;
}

function solve(rows, values, ridge = 1e-3) {
  const width = rows[0].length;
  const normal = Array.from({ length: width }, () => Array(width + 1).fill(0));
  for (let row = 0; row < rows.length; row += 1) for (let i = 0; i < width; i += 1) {
    for (let j = 0; j < width; j += 1) normal[i][j] += rows[row][i] * rows[row][j];
    normal[i][width] += rows[row][i] * values[row];
  }
  for (let i = 0; i < width; i += 1) {
    if (i) normal[i][i] += ridge;
    let pivot = i;
    for (let row = i + 1; row < width; row += 1) if (Math.abs(normal[row][i]) > Math.abs(normal[pivot][i])) pivot = row;
    [normal[i], normal[pivot]] = [normal[pivot], normal[i]];
    const divisor = normal[i][i];
    if (Math.abs(divisor) < 1e-12) return Array(width).fill(0);
    for (let column = i; column <= width; column += 1) normal[i][column] /= divisor;
    for (let row = 0; row < width; row += 1) if (row !== i) {
      const multiplier = normal[row][i];
      for (let column = i; column <= width; column += 1) normal[row][column] -= multiplier * normal[i][column];
    }
  }
  return normal.map((row) => row[width]);
}

function metrics(actual, predicted) {
  const average = mean(actual);
  const sse = actual.reduce((sum, value, index) => sum + (value - predicted[index]) ** 2, 0);
  const sst = actual.reduce((sum, value) => sum + (value - average) ** 2, 0);
  return { r2: sst ? 1 - sse / sst : 0, mae: actual.reduce((sum, value, index) => sum + Math.abs(value - predicted[index]), 0) / actual.length, directionalAccuracy: actual.filter((value, index) => Math.sign(value) === Math.sign(predicted[index])).length / actual.length };
}

function fitScaler(train, key) {
  const average = mean(train.map((point) => point[key]));
  const deviation = Math.sqrt(mean(train.map((point) => (point[key] - average) ** 2))) || 1;
  return (value) => (value - average) / deviation;
}

function predictions(train, test, sourceEnabled) {
  const previous = fitScaler(train, "previousReturn");
  const source = fitScaler(train, "sourceValue");
  const row = (point) => sourceEnabled ? [1, previous(point.previousReturn), source(point.sourceValue)] : [1, previous(point.previousReturn)];
  const weights = solve(train.map(row), train.map((point) => point.return));
  return test.map((point) => weights.reduce((sum, weight, index) => sum + weight * row(point)[index], 0));
}

function buildSamples(sourceByTime, targetRows, lag, horizon) {
  const samples = [];
  for (let index = 1; index + horizon < targetRows.length; index += 1) {
    const featureDate = targetRows[index - lag]?.time;
    const feature = sourceByTime.get(featureDate);
    if (!feature || feature.availableAt > targetRows[index].time) continue;
    samples.push({ time: targetRows[index].time, return: targetRows[index + horizon].price / targetRows[index].price - 1, previousReturn: targetRows[index].price / targetRows[index - 1].price - 1, sourceValue: feature.value });
  }
  return samples;
}

function walkForward(samples) {
  const firstTest = Math.max(24, Math.floor(samples.length * 0.5));
  const remaining = samples.length - firstTest;
  const foldSize = Math.floor(remaining / 3);
  if (foldSize < 8) throw new Error("insufficient_leakage_safe_history");
  const folds = [];
  const actual = []; const baselinePredictions = []; const augmentedPredictions = [];
  for (let fold = 0; fold < 3; fold += 1) {
    const testStart = firstTest + fold * foldSize;
    const testEnd = fold === 2 ? samples.length : testStart + foldSize;
    const train = samples.slice(0, testStart); const test = samples.slice(testStart, testEnd);
    const baselinePrediction = predictions(train, test, false); const augmentedPrediction = predictions(train, test, true); const observed = test.map((point) => point.return);
    const baseline = metrics(observed, baselinePrediction); const augmented = metrics(observed, augmentedPrediction);
    folds.push({ fold: fold + 1, trainSize: train.length, testSize: test.length, baseline, augmented, deltaR2: augmented.r2 - baseline.r2 });
    actual.push(...observed); baselinePredictions.push(...baselinePrediction); augmentedPredictions.push(...augmentedPrediction);
  }
  return { folds, baseline: metrics(actual, baselinePredictions), augmented: metrics(actual, augmentedPredictions) };
}

export function runAlphaTest({ source, target, lag = 10, horizon = 1 }) {
  if (!Array.isArray(source) || !Array.isArray(target) || !Number.isInteger(lag) || lag < 0 || lag > 30 || !Number.isInteger(horizon) || horizon < 1 || horizon > 20) throw new Error("invalid_alpha_input");
  const targetRows = target.map((row) => ({ time: time(row.timestamp), price: finite(row.price, "price") })).sort((a, b) => a.time - b.time);
  const sourceRows = source.map((row) => ({ time: time(row.timestamp), availableAt: time(row.availableAt ?? row.timestamp), value: finite(row.value, "value") })).sort((a, b) => a.time - b.time);
  const sourceByTime = new Map(sourceRows.map((row) => [row.time, row]));
  const maximumLag = Math.max(10, lag);
  const correlationByLag = [];
  for (let candidateLag = 0; candidateLag <= maximumLag; candidateLag += 1) {
    const candidate = buildSamples(sourceByTime, targetRows, candidateLag, horizon);
    const sourceValues = candidate.map((point) => point.sourceValue); const returns = candidate.map((point) => point.return);
    correlationByLag.push({ lag: candidateLag, pearson: correlation(sourceValues, returns), spearman: spearman(sourceValues, returns), sampleSize: candidate.length });
  }
  const viable = correlationByLag.filter((candidate) => candidate.sampleSize >= 48);
  if (!viable.length) throw new Error("insufficient_leakage_safe_history");
  const best = viable.reduce((winner, candidate) => Math.abs(candidate.pearson) > Math.abs(winner.pearson) ? candidate : winner);
  const samples = buildSamples(sourceByTime, targetRows, best.lag, horizon);
  const evaluation = walkForward(samples);
  const sourceValues = samples.map((point) => point.sourceValue); const returns = samples.map((point) => point.return);
  const mi = mutualInformation(sourceValues, returns);
  const deltas = evaluation.folds.map((fold) => fold.deltaR2);
  const averageDelta = mean(deltas); const deltaDeviation = Math.sqrt(mean(deltas.map((value) => (value - averageDelta) ** 2)));
  const stabilityAcrossFolds = Math.max(0, Math.min(1, 1 - deltaDeviation / (Math.abs(averageDelta) + 0.05)));
  const deltaR2 = evaluation.augmented.r2 - evaluation.baseline.r2;
  const warnings = [];
  if (samples.length < 120) warnings.push("LIMITED_SAMPLE_SIZE");
  if (deltas.filter((value) => value > 0).length < 2) warnings.push("UNSTABLE_ACROSS_FOLDS");
  if (Math.abs(best.pearson) > 0.95) warnings.push("SUSPICIOUS_PERFECT_CORRELATION");
  const evidenceScore = Math.max(0, Math.min(100, Math.round(20 + Math.max(-0.02, Math.min(0.05, deltaR2)) * 500 + stabilityAcrossFolds * 20 + Math.min(15, samples.length / 30) + Math.min(10, mi * 10) - warnings.length * 8)));
  return { baseline: evaluation.baseline, augmented: evaluation.augmented, deltaR2, bestLag: best.lag, correlationByLag, mutualInformation: mi, crossCorrelation: best.pearson, folds: evaluation.folds, stabilityAcrossFolds, sampleSize: samples.length, evidenceScore, horizon, warnings };
}

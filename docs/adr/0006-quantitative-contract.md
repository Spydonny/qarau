# ADR 0006: Quantitative validation and Alpha Score V1

- Status: Accepted
- Date: 2026-09-05
- Decisions: D-14, D-16

## Context

The research claim must be repeatable and leakage-safe. Formulas, split rules, selection thresholds, and penalties cannot be chosen after looking at the final test period.

## Data preparation

- Observations are ordered by `available_at`, then stable source record key. Backward as-of joins require `available_at <= prediction_time` and a configured maximum staleness.
- Decimal measurements are parsed to finite numbers only inside analysis. Imputation, scaling, winsorization, rolling transforms, and unit conversions are fitted on train data and applied forward.
- Duplicate rows use the stable source key; conflicting duplicates block publication. Exact duplicate columns/signals are collapsed before screening. Correlation magnitude at least 0.999999 with equal missingness masks is a duplicate-information warning requiring one feature to be removed.
- Missingness is measured for each split and in ten equal-count chronological windows. A split rate change above 0.10 or any adjacent-window change above 0.20 blocks publication unless the run records an approved deterministic explanation and no target-derived imputation.

## Splits and inference

- Use chronological 60/20/20 train/validation/test boundaries after alignment. Each split requires at least 60 effective observations; otherwise publication is blocked.
- Candidate construction and first-pass screening use train only. Transformation, lag, horizon, and thresholds are frozen after validation. Test is evaluated once per sealed manifest.
- Purge equals the maximum forward-return horizon. Embargo equals `max(horizon, 5)` observations on both sides of train/validation and validation/test boundaries.
- Pearson and Spearman follow their standard sample estimators. Mutual information uses ten equal-frequency bins fitted on train. Lagged correlation tests only the manifest allowlist.
- P-values for the frozen candidate family use Benjamini-Hochberg correction at false-discovery rate 0.05. Overlapping horizons use Newey-West/HAC standard errors with lag equal to the forward horizon minus one.
- The untouched test is reported separately and divided chronologically into three equal-count named regimes. Regime results cannot re-select a candidate.

## Metrics

- Directional accuracy is correct non-zero sign predictions divided by eligible predictions; zero target returns are excluded and counted separately.
- Return spread is mean forward return of the top signal quintile minus the bottom quintile, with quintile cut points fitted on train.
- The Sharpe-like value is mean spread divided by its sample standard deviation times the square root of periods per year: 365 crypto daily, 252 traditional daily, 52 weekly, 12 monthly. Zero variance returns zero and a warning.
- Maximum drawdown is the largest peak-to-trough decline of the cumulative unlevered spread series.
- Predictive sign is fixed on validation. A test/regime sign reversal is a blocking robustness failure.

## Quality and score

All component scores are clamped to `[0,100]` and inputs/outputs are stored.

- Completeness = `100 × (1 - missing_rate)`.
- Uniqueness = `100 × (1 - duplicate_rate)`.
- Continuity = stored observed/expected interval ratio × 100.
- Outlier health = `100 × (1 - min(outlier_rate / 0.10, 1))`.
- Data Quality = `0.35 completeness + 0.25 uniqueness + 0.25 continuity + 0.15 outlier health`.
- Predictive Strength = `50 × min(abs(test_IC) / 0.10, 1) + 30 × min(abs(test_Spearman) / 0.10, 1) + 20 × I(q <= 0.05)`.
- Test OOS Performance = `40 × clamp((directional_accuracy - 0.50) / 0.10) + 30 × clamp(abs(spread_sharpe) / 1.5) + 30 × clamp(1 - abs(max_drawdown) / 0.30)`.
- Robustness = percentage of the three regimes with the frozen sign, multiplied by `min(regime_count / 3, 1)`.
- Freshness = `100 × max(0, 1 - age / (2 × expected_update_interval))`, where age is measured from the latest eligible source `available_at` to the fixed market-snapshot cutoff recorded in the manifest. It never uses execution or package-sealing wall-clock time.
- Alpha Score = `0.15 Data Quality + 0.20 Predictive Strength + 0.30 Test OOS Performance + 0.20 Robustness + 0.15 Freshness - Leakage Penalty`.
- Leakage Penalty is 100 for any blocking leakage condition, 15 for unverified provider latency, 10 for unresolved suspicious instantaneous correlation, and otherwise zero. Any blocking condition prohibits packaging regardless of numeric score.

`clamp(x)` above means `min(max(x, 0), 1)`. The final score is clamped to `[0,100]` and rounded half-away-from-zero to two decimals. V1 publishability requires no blocking condition, approved license rights, all split minima, `q <= 0.05`, test directional accuracy at least 0.52, and Alpha Score at least 60.

## Consequences and verification

An LLM may propose allowlisted hypotheses and explain stored metrics, but cannot compute, alter, or approve the score. Golden fixtures must cover every formula boundary, split edge, purge/embargo, duplicate information, missingness drift, sign reversal, and rounding rule before INT-031 implementation.

# ADR 0005: Immutable access policy and private delivery

- Status: Accepted
- Date: 2026-09-05
- Decisions: D-11, D-12, D-14

## Context

An access-tier label is insufficient unless it deterministically selects different committed artifact bytes. Policy duplication between JSON, DatasetCommitment, and Sale can otherwise drift.

## Decision

- V1 tiers are `EXCLUSIVE_EARLY = 1` and `DELAYED = 2`; the allowed mask is `1..3`.
- The canonical access-policy artifact contains only `policy_version`, `grant_scope`, `allowed_tier_mask`, `early.available_immediately`, `delayed.version_lag`, `delayed.release_seconds`, and `expiry.grant_duration_seconds`.
- Durations are positive base-10 integer strings in the artifact and checked `u64` on-chain. `grant_scope` is `PURCHASED_DATASET_LINE`.
- The policy hash and every authorization-relevant primitive are copied into DatasetCommitment/Sale and compared field-for-field by the publisher signer and delivery API.
- Early resolves immediately to the purchased commitment. Before delayed release, Delayed resolves to the sale's prevalidated earlier commitment at exactly the committed version lag; after release it resolves to the purchased commitment.
- Every selected version must have its own active finalized DatasetCommitment and sealed artifact role. Missing artifacts deny access; there is no fallback to another version.
- The backend derives the AccessGrant PDA from the session wallet and purchased commitment, validates it at finalized commitment, and streams bytes itself. No object key or signed URL is exposed.

## Consequences

Policy is immutable for a published package. A faulty policy requires a new DatasetPackage and commitment. `grant_duration_seconds = 0` is invalid.

## Verification

The vertical tracer publishes v1/v2, sells v2 with v1 delayed, proves Early=v2 and Delayed=v1, then creates v3 and proves neither grant silently follows it. Ungranted and adjacent-ID requests return 403.

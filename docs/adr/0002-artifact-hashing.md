# ADR 0002: Canonical artifacts and hash domains

- Status: Accepted
- Date: 2026-09-05
- Decisions: D-08, D-09

## Context

Proof-of-Alpha is meaningful only when Node, Rust, storage, and verification hash exactly the same bytes. Generic `JSON.stringify` calls, timestamps in manifests, implicit float formatting, and compressed representations would make commitments non-reproducible.

## Decision

- Canonical JSON recursively sorts object keys and emits UTF-8 without BOM or insignificant whitespace. Canonical contract numbers are safe integers; measurements are normalized decimal strings. Analysis-result floating-point values follow RFC 8785/JCS rules in their dedicated implementation.
- Canonical JSONL is one canonical object per line, LF only, with a final LF. Rows use deterministic primary timestamp and tie-breaker ordering.
- The exact uncompressed plaintext bytes are authoritative. Compression and Parquet are derivatives with separate, non-authoritative hashes.
- Each artifact is SHA-256 hashed over a fixed UTF-8 domain prefix followed by exact bytes. Domains are defined in `server/domain/canonical-artifacts.mjs`.
- A dataset ID is `SHA256("QARAU_DATASET_ID_V1\\0" || UUID_16_BYTES)` and an on-chain version is little-endian `u32` in PDA seeds.
- The deterministic analysis manifest contains no execution ID or wall-clock timestamps. Those live in `analysis_runs`.
- Golden inputs and expected digests are committed under `contracts/fixtures/` and cross-checked in Node and Rust.

## Consequences

Changing a domain, encoding, field meaning, or canonicalization rule requires a new version; published V1 hashes are never reinterpreted. Implementations must hash stored bytes rather than regenerate an equivalent object from database rows.

## Verification

`npm test` and `cargo test -p qarau-registry --lib` must produce the same access-policy and dataset-ID fixture digests. Tamper tests must change the digest.

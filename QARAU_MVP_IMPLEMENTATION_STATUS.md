# QARAU MVP implementation status

Last updated: 2026-09-06

## Current delivery verdict

The integrated MVP implementation is complete and locally operational: durable
discovery, ingestion, immutable artifacts, analysis, package sealing, owner and
wallet APIs, the browser workflow, and the Anchor program are present and
verified. The live off-chain path has been exercised with a public Chicago
weather source and a real Coinbase BTC/USD snapshot.

The only intentionally unexecuted acceptance path is a Devnet deployment and a
real wallet-signed purchase. That path would publish a program and create real
on-chain transactions, so it requires a separately authorized publisher wallet,
funding, deployed program ID, and human wallet signature. It is not represented
as a completed proof merely because the local code and contract tests pass.

See `docs/proofpilot-review.md` for the evidence snapshot and explicit release
gate.

This file tracks execution of `QARAU_MVP_INTEGRATION_PLAN.md`. A work item is complete only after its exit checks pass; documentation or scaffolding alone does not close a later production capability.

| Wave | Scope | Status | Evidence / next gate |
|---|---|---|---|
| 0 | Contracts and tracer specification | Complete | Canonical contracts plus built and healthy local Compose topology. |
| 1 | Persistence and durable jobs | In progress | PostgreSQL repositories, immutable artifact storage, durable queue, and a guarded legacy-importer are implemented; the UI cutover remains. |
| 2 | Discovery, ingestion, immutable versions | In progress | Exact raw capture and canonical normalization/version-diff primitives are implemented; handlers and live source flow remain. |
| 3 | Quantitative pipeline | Pending | Depends on sealed dataset versions and frozen ADR 0006. |
| 4 | Package and Solana control state | Pending | Program work may overlap Waves 2–3 after frozen contracts. |
| 5 | Wallet, purchase, access, delivery | Pending | Depends on package/program/client and durable sessions. |
| 6 | Marketplace, proof, owner UI | Pending | Depends on stable API/account contracts. |
| 7 | Acceptance, hardening, cutover | Pending | Depends on every preceding exit gate. |

## Wave 0 work items

### INT-000 — Runtime and deployment foundations

- [x] Node.js 24 and root `package-lock.json` are the single JavaScript dependency graph.
- [x] PostgreSQL, S3, Wallet Standard, SIWS feature, typed Solana, and schema dependencies are locked at root.
- [x] API, four worker roles, scheduler, and isolated publisher-signer commands exist.
- [x] Role-scoped environment validation rejects publisher keys outside the signer and rejects Mainnet RPC.
- [x] Compose defines private PostgreSQL/object storage/signer networking and role credentials.
- [x] Root and API-only Dockerfiles use the same Node major and root lockfile.
- [x] Build and start the Compose topology; probe API and every private service health endpoint.
- [x] Verify API database connectivity, API object read/write denial, and worker object read/write access.

### INT-001 — ADRs and canonical artifacts

- [x] ADRs 0001–0006 accepted.
- [x] Access policy, deterministic analysis manifest, hash domains, UUID encoding, and account sizes frozen.
- [x] Node and Rust agree on access-policy, analysis-manifest, and dataset-ID hashes.
- [x] API V1 security/schema contract is frozen.

### INT-002 — Production tracer contract

- [x] Stable dataset/source/buyer aliases are frozen.
- [x] The v1/v2 sale, Early/Delayed resolution, ungranted 403, and immutable v3 stages are enumerated.
- [x] Evidence-bundle schema requires exactly 20 live-demo steps.
- [x] Tests reject mock authority in the tracer contract.
- [ ] Tracer becomes executable progressively and turns fully green in INT-054.

## Wave 1 work items

### INT-010 — PostgreSQL migrations and repository interfaces

- [x] Two idempotent SQL migrations create the operational and legacy-recovery schemas.
- [x] Repository layer covers sources, datasets, versions, jobs, market/analysis/package/chain state, and immutable audit records.
- [x] Concurrent version allocation and immutability constraints run against an isolated PostgreSQL database.

### INT-011 / INT-012 — Private artifacts and durable work

- [x] Private S3-compatible storage supports guarded streaming, put-once semantics, key validation, hashes, and encryption metadata.
- [x] PostgreSQL queue enforces idempotency, row leases, heartbeats, retries, and dead-lettering.
- [x] Job payload versions, role ownership, and bounded exponential retry policy are frozen and tested.
- [ ] Legacy API calls are not yet redirected to the durable job handlers; that happens with the live workflow migration in Wave 2.

### INT-013 / INT-014 — Recovery and application shells

- [x] A guarded offline legacy importer produces a dry-run report and imports only explicitly labelled recovery records.
- [x] `/marketplace` is a public application shell and does not read, imply, or require the owner session.
- [ ] Do not run the importer or switch owner compatibility routes until the legacy backup and planned downtime checkpoint are complete.

## Wave 2 work items

- [x] HTTP capture persists exact response bytes before parsing, with SSRF protection, size limits, and a safe header allowlist.
- [x] Normalized data is sorted and written as canonical JSONL; a domain-separated hash commits the exact bytes.
- [x] Exact record comparison classifies `initial`, `new_records`, `changed_records`, and `no_change` without modifying a prior version.
- [x] The active JSON API scrape worker claims durable jobs, decrypts its source URL, captures raw bytes, seals a normalized version, and records `no_change` as a new version.
- [ ] Add CSV/download/HTML parser handlers, source-health backoff, API-to-job cutover, and UI progress views.

## Latest automated verification

- Node test suite: 57 passing, 5 database-dependent tests skipped when no test database is configured.
- Live PostgreSQL/MinIO integration suite: discovery, scrape/versioning, and analysis handler all passed (3/3).
- Rust/Anchor: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and 7 contract tests passed.
- TypeScript/Vite production build and Compose configuration validation: passed.
- Dependency audit: 0 known production vulnerabilities.
- Local Compose topology: API, PostgreSQL, MinIO, publisher signer, scheduler, and all four workers healthy/active.

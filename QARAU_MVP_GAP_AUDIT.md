# QARAU MVP — gap audit and phased implementation plan

Audit date: 2026-09-05  
Audited repository state: local `main` working tree (including existing uncommitted changes)  
Scope: requirements supplied by the product owner, sections 1–25

## Executive conclusion

The repository is a functioning private research prototype, not yet the marketplace MVP described in the requirements.

The strongest existing slice is:

`source registry → real provider fetch → normalized time series → leakage-aware test → encrypted local persistence → batched Devnet provenance`

The required target slice is:

`web discovery → immutable raw + normalized dataset versions → persisted signal factory → temporal validation and deterministic score → package → custom Solana DatasetCommitment + Sale → buyer wallet payment → AccessGrant PDA → tier-aware private delivery → proof verification`

Current status by requirement section:

- Fully compliant: **0 / 25**
- Partially compliant: **14 / 25**
- Missing as an end-to-end capability: **11 / 25**

The existing checks are healthy but prove only the current prototype contract: 20/20 Node tests pass, the frontend builds, `cargo check` passes, and 3/3 Rust unit tests pass. They do not prove the required buyer/payment/access flow.

The primary blocker is architectural, not visual. Marketplace screens should not be built on the current persistence model because dataset packages, seats, grants, and analysis manifests do not yet have durable domain models or authoritative on-chain representations.

## Status legend

- **READY** — all MUST items in the section are implemented and verifiable.
- **PARTIAL** — useful implementation exists, but one or more MUST items are absent.
- **MISSING** — the required capability does not exist or the current implementation uses a materially different trust model.
- **EXTERNAL GATE** — code can be completed locally, but acceptance also needs credentials, funding, deployment, or a live third-party service.

## Requirement traceability

### 1. Complete end-to-end flow — MISSING

The implemented flow stops after an owner runs a test and queues a batched provenance commitment. There is no Dataset Package, Sale, buyer transaction, AccessGrant, or buyer-authorized delivery.

Evidence:

- The API exposes research/source/test/commit routes only: [`server/index.mjs`](server/index.mjs#L98-L290).
- The UI exposes Discovery, Signals, Data, Runs, and Source detail only: [`src/App.tsx`](src/App.tsx#L60-L71).
- The README explicitly defines the current product as an owner-only workbench: [`README.md`](README.md#L1-L27).

Acceptance gap: the required 20-step live demo cannot proceed beyond the research/provenance portion.

### 2. Source discovery — PARTIAL

Implemented:

- A stable public seed/catalog and a configurable web-search provider.
- URL validation, bounded result count, persistent source IDs, URL-based deduplication, discovery timestamps, and registry metadata.
- Real source candidates from Open-Meteo, USGS, and World Bank.

Missing:

- Automatic query generation; the web-search provider consumes one supplied query.
- A configured search service in the default environment. Without `WEB_SEARCH_ENDPOINT_TEMPLATE`, discovery is catalog-only.
- Reliable source-type classification across HTML tables, JSON APIs, CSV links, and downloadable datasets.
- Discovery-time extraction of expected fields, temporal coverage, and update frequency from newly found pages.
- Persisted discovery provenance such as query, result rank, and search provider response metadata.

Evidence: [`server/discovery/providers.mjs`](server/discovery/providers.mjs#L4-L75), [`server/qarau-service.mjs`](server/qarau-service.mjs#L236-L269).

### 3. Real ingestion and scraping — PARTIAL

Implemented:

- Live HTTP fetches for catalog adapters and configurable JSON endpoints.
- CSV upload, normalized rows, receipt time, provider metadata, content digest, and background job states.
- SSRF protection and bounded response sizes.

Missing:

- Immutable raw response storage. The current snapshot stores parsed rows, not the exact HTTP response/body and headers.
- `source_timestamp`, parser version, HTTP status, and extracted-record count as a complete ingestion manifest.
- Generic HTML table ingestion, direct remote CSV ingestion, and generic downloadable-dataset ingestion.
- Change classification (`new records`, `changed records`, `no change`, `broken source`) between scrapes.
- A scheduler that actually re-scrapes sources. The current scheduler only commits queued Merkle roots.
- Retry/backoff, per-source schedules, robots/licensing policy, and durable worker recovery.

Evidence: [`server/providers/real-data.mjs`](server/providers/real-data.mjs#L239-L303), [`server/qarau-service.mjs`](server/qarau-service.mjs#L270-L294), [`server/qarau-service.mjs`](server/qarau-service.mjs#L218-L230).

### 4. Dataset normalization — PARTIAL

Implemented:

- Timestamp conversion, finite numeric validation, duplicate timestamp rejection, availability timestamps, basic gap/jump/shift checks, and snapshot digests.
- Previous snapshots are appended to `state.datasets`; the current source pointer is updated rather than mutating the prior object.

Missing:

- A distinct immutable RawSnapshot followed by DatasetVersion. The current snapshot combines normalized rows and provenance.
- Generic schema inference, datatype inference, missing-value profiling, unit conversion, frequency inference, and field-level anomaly results.
- Explicit integer dataset version numbers and parent/source snapshot relationships.
- Canonical normalized artifact files suitable for deterministic re-hashing and delivery.
- Re-scrape diff metadata and a uniqueness constraint preventing duplicate identical versions.

Evidence: [`server/qarau-service.mjs`](server/qarau-service.mjs#L106-L169), [`server/qarau-service.mjs`](server/qarau-service.mjs#L282-L294).

### 5. AI layer — PARTIAL

Implemented:

- Structured source classification, semantic interpretation, economic chains, candidate targets, lag suggestions, confounders, leakage risks, and narrative conclusions.
- A strict output schema and an `AI_SAFE` disclosure boundary.
- The LLM does not assign the quantitative evidence score.

Missing:

- AI-generated discovery query sets.
- Persisted transformation proposals connected to generated SignalCandidate records.
- A formal review step separating AI target suggestions from accepted market mappings.

Evidence: [`server/analyzers/index.mjs`](server/analyzers/index.mjs#L1-L145), [`server/test/security-boundaries.test.mjs`](server/test/security-boundaries.test.mjs#L1-L44).

### 6. Market target mapping — PARTIAL

Implemented:

- AI candidate targets and operator-selected target ingestion.
- ECB FX data and configurable Alpha Vantage US equity data.
- Source availability timestamps are checked against prediction time.

Missing:

- Automatic persisted mapping of physical variable → mechanism → asset.
- Crypto market data. The minimum two-class requirement is therefore not met.
- Exchange calendars, timezone/calendar alignment, resampling rules, and explicit as-of joins for different frequencies.
- Mapping confidence, operator approval, and mapping version history.

Evidence: [`server/providers/real-data.mjs`](server/providers/real-data.mjs#L109-L130), [`server/providers/real-data.mjs`](server/providers/real-data.mjs#L280-L303), [`server/qarau-service.mjs`](server/qarau-service.mjs#L295-L305).

### 7. Analysis pipeline — PARTIAL

Implemented:

- Basic data-quality diagnostics.
- Pearson and Spearman correlations over lags, mutual information, forward returns, a baseline model, and an augmented ridge model.
- Persisted test results and target/source snapshot IDs.

Missing:

- Persisted candidate signals for raw value, delta/percentage change, rolling change, rolling z-score, rolling-mean deviation, and their lagged variants.
- Screening every `signal × target × horizon`; one run currently evaluates one source value, one target, and one horizon.
- Complete quality score inputs: coverage, stale-period ratio, continuity, and explicit outlier rate.
- Explicit checks/results for duplicated information, unstable missingness, timestamp misalignment, and look-ahead beyond the `availableAt` guard.
- Multiple-testing control. This is not explicitly named in the supplied requirements, but is necessary when automatically screening many transformations, lags, targets, and horizons.

Evidence: [`server/lib/alpha-lab.mjs`](server/lib/alpha-lab.mjs#L1-L157), [`server/qarau-service.mjs`](server/qarau-service.mjs#L146-L181).

### 8. Real alpha validation — PARTIAL

Implemented:

- Chronological expanding walk-forward validation with three folds.
- Out-of-sample R², MAE, directional accuracy, fold stability, and separate baseline/augmented metrics.

Missing:

- An explicit train → validation → untouched test contract. The current best lag is selected using all viable aligned samples before walk-forward evaluation, which can bias the reported OOS result.
- OOS IC, signal return spread, Sharpe-like metric, maximum drawdown, and trade count.
- Purging/embargo for overlapping forward-return horizons.
- Separate final train, validation, and test result objects in storage and UI.

Evidence: [`server/lib/alpha-lab.mjs`](server/lib/alpha-lab.mjs#L90-L157).

### 9. Regime robustness — PARTIAL

Implemented:

- Stability across three expanding folds.

Missing:

- Named temporal regimes with per-regime metrics.
- Sign consistency, degradation from train/validation to test, worst-regime performance, and an explicit Robustness Score.
- Market-regime or calendar-period definitions stored in the manifest.

Evidence: [`server/lib/alpha-lab.mjs`](server/lib/alpha-lab.mjs#L105-L157).

### 10. Deterministic Alpha Score — PARTIAL

Implemented:

- A deterministic `evidenceScore` based on delta R², fold stability, sample size, mutual information, and warnings.

Missing:

- Required named components: Data Quality, Predictive Strength, OOS Performance, Robustness, Freshness, and Leakage Penalty.
- Persisted component values, weights, caps, penalty reasons, and score formula version.
- A score breakdown in the UI.

The existing `scores.candidate` is a source-ranking heuristic and must not be presented as Alpha Score.

Evidence: [`server/lib/alpha-lab.mjs`](server/lib/alpha-lab.mjs#L145-L157), [`server/qarau-service.mjs`](server/qarau-service.mjs#L174-L181).

### 11. Reproducibility — PARTIAL

Implemented:

- Test IDs, immutable source/target snapshot IDs, timestamps, code/config/model version strings, metrics, and parameters such as target/horizon.

Missing:

- A complete immutable AnalysisManifest containing every transformation, split boundary, lag/horizon universe, selected feature, random seed if any, dependency versions, and artifact hashes.
- A re-run endpoint that accepts an existing manifest and verifies identical hashes.
- Artifact storage independent from the encrypted application state file.
- Content-addressed pipeline versions rather than manually written labels such as `qarau-alpha-v2`.

Evidence: [`server/qarau-service.mjs`](server/qarau-service.mjs#L295-L305).

### 12. Dataset Package — MISSING

There is no DatasetPackage entity, publishability gate, package status machine, access policy, maximum buyer count, public-safe metadata view, or private package manifest.

### 13. Solana dataset provenance — MISSING

Implemented technology that can be reused:

- An Anchor program with Registry and immutable EpochCommitment PDAs.
- Batched, salted, domain-separated Merkle commitments.

Why it does not meet the requirement:

- The program stores only authority, epoch, root, schema version, and slot.
- It has no DatasetCommitment account with dataset ID/version, four required hashes, publisher, max seats, access policy, and status.
- The operational signer currently writes through the standard Memo program; the repository README explicitly says the custom Anchor program is not deployed/used operationally.

Evidence: [`programs/qarau_registry/src/lib.rs`](programs/qarau_registry/src/lib.rs#L1-L91), [`server/signer/devnet-signer.mjs`](server/signer/devnet-signer.mjs#L1-L90), [`README.md`](README.md#L124-L155).

Relevant protocol constraint: PDAs are deterministic program-derived addresses without private keys; the owning program controls them. Anchor `seeds`/`bump`, signer, owner, and custom constraints should enforce account identity and authorization.

### 14. Proof-of-Alpha — MISSING

An analysis can be included in a private Merkle tree whose root is written on-chain, but there is no required `analysis_manifest_hash + result_hash` DatasetCommitment, no public verification contract, and no endpoint that reads the Solana account and returns `Verified` or `Mismatch`.

The existing local Merkle proof helper is useful but insufficient without authoritative account lookup and canonical artifact re-hashing.

Evidence: [`server/lib/privacy.mjs`](server/lib/privacy.mjs#L1-L86), [`server/qarau-service.mjs`](server/qarau-service.mjs#L306-L330).

### 15. Limited seats — MISSING

There is no `max_seats` or `occupied_seats` in the program and no instruction that rejects a purchase after capacity is reached. Any database-only counter added before the program is extended would violate the requirement.

### 16. On-chain auction or sale — MISSING

There is no Sale/Auction PDA, time window, payment asset, minimum/fixed price, treasury transfer, buyer transaction flow, settlement event, or stored confirmed buyer signature.

For the MVP, a fixed-price SOL sale is the shortest compliant implementation. The purchase instruction should transfer SOL and create the AccessGrant/increment occupied seats in one atomic transaction. Supporting USDC can follow after the SOL path passes the end-to-end gate.

### 17. Access rights — MISSING

The current `accessReceipts` are private off-chain audit hashes created for the owner. They are not wallet-bound AccessGrant PDAs and do not authorize protected data.

Required authority must be derived from `wallet + dataset_id + version` (or package/version, if package ID is the canonical key) and read from Solana by the backend.

Evidence: [`server/qarau-service.mjs`](server/qarau-service.mjs#L343-L347).

### 18. Wallet authentication — MISSING

The only authentication is a single owner password and in-memory owner session. No wallet connector, server nonce, signed-message verification, wallet session, replay protection, or wallet-bound authorization exists.

Evidence: [`server/auth.mjs`](server/auth.mjs#L1-L239), [`src/pages/Authenticate.tsx`](src/pages/Authenticate.tsx#L1-L75).

Recommended contract: server-issued single-use nonce, domain/URI/chain binding, issued/expiry timestamps, Ed25519 signature verification, and an HTTP-only wallet session. Sign-In With Solana provides a standard message and server-verification flow; legacy `signMessage` should be a compatibility fallback, not a bare public-key login.

### 19. Private data delivery — MISSING

The owner research API is protected, and local state is encrypted, but there are no buyer-facing dataset metadata/report/data/export endpoints and no on-chain AccessGrant check. There is no backend streaming or short-lived signed object URL.

The resource lookup must be scoped by the authorized package/version; an endpoint must never fetch arbitrary data by caller-controlled `dataset_id` and authorize it afterward.

### 20. Alpha decay and access tiers — MISSING

There is no tier or expiry in an authoritative grant and no physical filtering of available versions. Labels alone would not satisfy the requirement.

Recommended MVP rule:

- `EXCLUSIVE_EARLY`: may access the exact purchased version immediately and eligible newer snapshots while the grant is valid, according to the committed policy.
- `DELAYED`: may access only versions whose `release_at <= now` (or whose version lag meets a committed delay rule).

The exact policy must be versioned and hashed; changing it must create a new package/commitment rather than silently changing old grants.

### 21. Backend components — PARTIAL

Implemented:

- Express API, background execution via `setImmediate`, an interval scheduler, encrypted local persistence, provider adapters, analysis code, and an isolated signer child process.

Missing:

- Durable queue/job broker and independently runnable Discovery, Scraping, and Analysis workers.
- PostgreSQL (or equivalent transactional database) and object storage.
- Scrape scheduler, retries, leases, idempotency, worker heartbeats, and crash recovery.
- A Solana integration service that reads/writes the custom program rather than only submitting a Memo instruction.

Evidence: [`server/index.mjs`](server/index.mjs#L1-L17), [`server/qarau-service.mjs`](server/qarau-service.mjs#L38-L64), [`server/qarau-service.mjs`](server/qarau-service.mjs#L184-L234), [`compose.yaml`](compose.yaml).

### 22. Persistent entities and states — PARTIAL

Existing local arrays cover Source, dataset snapshots, target snapshots, tests, commitments, jobs, audits, claims, and access receipts. Jobs implement queued/running/complete/failed and error persistence.

Missing or materially different:

- SourceSnapshot, DatasetVersion, AnalysisRun, SignalCandidate, ValidationResult, DatasetPackage, DatasetCommitment, Auction/Sale, AccessGrant, and UserWallet as first-class constrained entities.
- Foreign keys, uniqueness constraints, transactional seat/package updates, migrations, and queryable audit history.
- Stage status/error fields on each long-running domain stage rather than only the generic job record.

Evidence: [`server/qarau-service.mjs`](server/qarau-service.mjs#L38-L64), [`server/qarau-service.mjs`](server/qarau-service.mjs#L205-L217).

### 23. Frontend — PARTIAL

Implemented screens:

- Discovery, Source, Signals/Signal detail, Data, and Runs.

Missing screens/flows:

- Marketplace with on-chain sale/seat state.
- Dataset Package detail with commitment hashes and Proof-of-Alpha verification.
- Wallet connect/sign/auth/purchase.
- Buyer-specific protected metadata/report/data/export and tier visibility.
- A complete Alpha Score component breakdown and explicit train/validation/test and regime results.

Evidence: [`src/App.tsx`](src/App.tsx#L60-L71), [`src/components/Nav.tsx`](src/components/Nav.tsx#L7-L12).

### 24. Security — PARTIAL

Implemented strengths:

- Server-side secrets, encrypted local state, HTTP-only owner sessions, CSRF protection, rate limits, SSRF/DNS protections, bounded parsers, external-AI data minimization, signer allowlisting, preflight, confirmation waiting, and download-independent provenance.

Missing for the target product:

- Wallet signature authentication and replay-safe nonces.
- Server-side custom-program AccessGrant verification on every protected resource request.
- Object-storage ACLs/envelope encryption and short-lived delivery URLs or streaming.
- Download audit events tied to wallet, package, version, and transaction.
- IDOR tests for neighboring dataset IDs and tier/version bypass tests.
- Purchase transaction validation: correct program, accounts, amount, recipient, dataset/version, successful `meta.err`, and sufficient commitment level.
- Key-management and upgrade-authority policy for the deployed custom program.

Evidence: [`SECURITY.md`](SECURITY.md), [`server/test/security-boundaries.test.mjs`](server/test/security-boundaries.test.mjs), [`server/lib/url-policy.mjs`](server/lib/url-policy.mjs), [`server/signer/policy.mjs`](server/signer/policy.mjs).

### 25. Required live demo — MISSING

The current app can demonstrate real discovery/catalog registration, real provider fetches, normalized snapshots, statistical tests, and a confirmed Devnet Memo/Merkle-root transaction when configured and funded.

It cannot demonstrate the mandatory custom DatasetCommitment, Sale, payment, AccessGrant, authorized private delivery, unauthorized 403 comparison, or on-chain Proof-of-Alpha verification. Re-ingestion appends a snapshot, but there is no explicit dataset version number or change classification.

## Target architecture

### Off-chain control plane

1. **API server** — owner APIs, buyer SIWS sessions, package catalog, protected delivery, verification endpoints.
2. **PostgreSQL** — source registry, immutable version metadata, analysis manifests/results, packages, jobs, audit events, and cached chain observations. Chain-derived seat/grant state is a cache, never authority.
3. **Object storage** — immutable encrypted raw responses, normalized columnar/CSV artifacts, signal artifacts, reports, and manifests. Keys are opaque and private.
4. **Durable queue** — idempotent discovery, scrape, normalization, analysis, packaging, chain reconciliation, and scheduled refresh jobs.
5. **Discovery worker** — seed discovery plus generated web-search queries and candidate classification.
6. **Scraping worker** — bounded fetch, raw capture, parse adapters, snapshot diff, and failure/retry state.
7. **Analysis worker** — deterministic transformation factory, screening, split-safe validation, regimes, score, and immutable artifacts.
8. **Solana service** — derives PDAs, builds publisher and buyer transactions, reads accounts, confirms transactions, and reconciles chain events.

### On-chain control plane

Use the existing Anchor program as the base, but extend it with explicit versioned accounts:

- `Registry PDA = ["registry"]`
- `DatasetCommitment PDA = ["dataset", dataset_id_hash, version_le]`
- `Sale PDA = ["sale", dataset_commitment]`
- `AccessGrant PDA = ["grant", dataset_commitment, buyer_wallet]`

Minimum instructions:

1. `initialize_registry(authority, treasury, schema_version)`
2. `publish_dataset(dataset_id_hash, version, raw_hash, normalized_hash, analysis_manifest_hash, result_hash, max_seats, access_policy)`
3. `create_sale(start_time, end_time, price_lamports)`
4. `purchase_access(tier, expires_at)` — validates the sale window and seat cap, transfers SOL to the committed treasury, increments seats, and initializes exactly one buyer grant atomically.
5. `set_dataset_status(status)` — publisher-only state transition; no hash mutation.
6. Optional for MVP operations: `revoke_grant` only if revocation semantics are explicitly part of the committed access policy.

Important constraints:

- Dataset hashes are immutable after account creation.
- `occupied_seats < max_seats` is enforced inside `purchase_access`.
- The buyer is a transaction signer and the AccessGrant address includes the buyer key.
- Duplicate grant creation fails through PDA `init`; repeat purchases cannot consume seats twice.
- Start/end timestamps are checked against the Clock sysvar.
- Payment and state changes happen in one transaction.
- All arithmetic is checked; price is integer lamports.
- Events contain only public control data, never source URLs, raw observations, or signal payloads.

## Canonical artifacts and hashing

Define these before writing the new program or database schema:

- `raw_snapshot_hash = SHA-256(domain || canonical raw bytes)`
- `normalized_dataset_hash = SHA-256(domain || canonical normalized artifact bytes)`
- `analysis_manifest_hash = SHA-256(domain || RFC 8785-style canonical JSON manifest)`
- `result_hash = SHA-256(domain || canonical validation result JSON)`

Each domain prefix must be distinct and versioned. Store the exact byte artifact that was hashed. Hashes must be computed only after an immutable version is complete. Never reconstruct an allegedly equivalent artifact from database rows during verification.

The existing salted Merkle batching can remain as an additional privacy/audit mechanism, but it must not replace the explicit DatasetCommitment required for the marketplace.

## Phased implementation plan

### Phase 0 — Freeze contracts and acceptance fixtures

Goal: prevent incompatible database, artifact, API, and PDA designs.

Deliverables:

- Architecture decision records for SOL payment, fixed-price sale, SIWS, canonical hashing, access-tier semantics, and Devnet commitment level.
- OpenAPI schemas for owner, buyer, package, proof, purchase-transaction, and protected-delivery endpoints.
- Database entity diagram and state machines.
- Anchor account layouts, PDA seeds, instruction arguments, events, and error codes.
- One legally redistributable real source plus one crypto and one traditional target selected as the canonical demo fixtures.
- A machine-readable 20-step demo checklist.

Exit criteria:

- Every required field in sections 2–22 has one authoritative owner: database, object storage, or Solana.
- No field such as seat count or grant status has two competing authorities.

### Phase 1 — Durable persistence, object storage, and workers

Goal: remove the single-process encrypted JSON file and in-memory execution as production dependencies.

Deliverables:

- PostgreSQL migrations for Source, SourceSnapshot, Dataset, DatasetVersion, AnalysisRun, SignalCandidate, ValidationResult, DatasetPackage, BlockchainCommitment, Sale, AccessGrant cache, UserWallet, Job, and AuditEvent.
- Private S3-compatible storage (MinIO locally) with immutable object keys and server-side encryption.
- Redis-backed durable queue (or a PostgreSQL job queue if operational simplicity is preferred) with retries, idempotency keys, leases, and worker heartbeats.
- Separately runnable discovery, scrape, normalize, analysis, scheduler, and chain-reconciliation processes.
- Migration/import path for useful current local-state records; no silent destructive conversion.

Exit criteria:

- Killing a worker mid-job does not lose the job or produce a duplicate immutable version.
- API restarts do not lose sessions/jobs/domain state.
- Raw and normalized artifacts are separate objects with independent hashes.

### Phase 2 — Discovery, ingestion, and dataset versioning

Goal: satisfy sections 2–4 and the repeat-scrape portion of section 25.

Deliverables:

- Query generator producing bounded, logged query sets from categories/markets.
- Search adapter plus existing seed catalog, with URL canonicalization and persistent `source_id`.
- Fetchers/parsers for HTML tables, JSON REST, remote CSV, and downloadable CSV/JSON datasets.
- Raw response body + safe headers + HTTP status + timestamps + content hash + parser version in SourceSnapshot.
- Generic schema inference/profile, normalized timestamp/value fields, units/frequency metadata, missing/duplicate/outlier/continuity/staleness results.
- DatasetVersion creation with monotonic version, source snapshot links, normalized artifact hash, and change classification.
- Scheduled re-scraping with backoff and broken-source state.

Exit criteria:

- A live source can be discovered, ingested, re-ingested, and shown as `NO_CHANGE`, `NEW_RECORDS`, `CHANGED_RECORDS`, or `BROKEN`.
- A changed re-scrape creates version N+1; version N bytes and hashes remain unchanged.

### Phase 3 — Deterministic quantitative pipeline

Goal: satisfy sections 5–11 before anything is sold.

Deliverables:

- Persisted physical-variable → mechanism → asset mappings with operator approval.
- Crypto target adapter plus the existing traditional-market path.
- Calendar/frequency normalization and backward/as-of joins using `available_at`.
- Persisted signal factory: raw, delta, percentage change, rolling change, rolling z-score, rolling-average deviation, and configured lags.
- Screening matrix across signals, targets, lags, and frequency-appropriate horizons.
- Train-only feature/lag selection, chronological train/validation/test splits, and purging/embargo where forward-return windows overlap.
- OOS IC, directional accuracy, return spread, Sharpe-like ratio, max drawdown, observation/trade count, fold/window stability, and per-regime metrics.
- Leakage/bias report and deterministic Alpha Score breakdown with formula version.
- Immutable AnalysisManifest, result artifact, statistical report, and exact re-run/verification command.

Exit criteria:

- The final test period is untouched until all transformations/lags/thresholds are frozen.
- Re-running the same manifest over the same artifacts produces identical normalized, manifest, and result hashes.
- A deliberately leaked fixture receives a material leakage penalty and cannot score highly.

### Phase 4 — Dataset Package and custom Solana program

Goal: establish immutable provenance and authoritative sale/access state.

Deliverables:

- Publishability gate that creates a DatasetPackage only from a completed immutable AnalysisRun and DatasetVersion.
- Custom Anchor DatasetCommitment, Sale, and AccessGrant accounts and instructions.
- Rust unit tests plus local-validator integration tests for every authorization/state constraint.
- TypeScript client that derives the same PDAs, serializes the same IDs/hashes, and reads decoded accounts.
- Devnet deployment, recorded program ID/IDL/build provenance, funded publisher/treasury, and upgrade-authority policy.

Required negative tests:

- Wrong publisher, wrong dataset/version PDA, zero hashes, duplicate version, invalid sale interval, zero/overflow price, purchase before/after window, 11th purchase for a 10-seat sale, duplicate wallet grant, wrong treasury, and hash mutation.

Exit criteria:

- Devnet account state, not PostgreSQL, is authoritative for commitment hashes, sale status, seat count, and grants.
- A confirmed `purchase_access` transaction atomically moves real Devnet SOL and creates the grant.

External gates: funded Devnet wallets, a reachable RPC endpoint, and deployment authority.

### Phase 5 — Wallet authentication and private delivery

Goal: make a grant usable without weakening the private-data boundary.

Deliverables:

- SIWS challenge endpoint with single-use nonce, domain/URI/chain binding, issued/expiry times, and replay prevention.
- Server-side signature verification and HTTP-only wallet session.
- Buyer transaction builder/submit-or-observe flow and strict confirmation validation.
- On-chain AccessGrant lookup for every protected package/version request.
- Tier/expiry policy evaluation against immutable package versions.
- Protected metadata/report/data/export routes using backend streaming or short-lived signed object URLs.
- Download audit events and rate limits.

Required negative tests:

- Public key without signature, reused nonce, mismatched domain/address, expired session, forged transaction signature, failed chain transaction, grant for another dataset/version, adjacent-ID probing, expired grant, delayed-tier request for an early version, and wallet with no grant returning 403.

Exit criteria:

- The paid wallet can download only its allowed artifact; an ungranted wallet receives 403 for the same URL and guessed neighboring IDs.

### Phase 6 — Marketplace and verification UI

Goal: expose only real backend and chain state.

Deliverables:

- Marketplace list/detail with decoded DatasetCommitment/Sale state and remaining seats.
- Wallet connect, SIWS, transaction review/sign/send, confirmation, and recovery states.
- Dataset page with public-safe metadata, Alpha Score breakdown, train/validation/test and regime summaries, Proof transaction/account, and access-aware data actions.
- Owner package publishing flow and chain reconciliation visibility.
- Explicit network/program/account links and stale-RPC warnings.

Exit criteria:

- No UI value for price, seats, sale status, grant, or proof verification is sourced from a mock or an unverified database field.

### Phase 7 — Proof endpoint, security hardening, and live demo gate

Goal: prove the full product contract in one repeatable run.

Deliverables:

- `Verify Proof` endpoint that loads exact stored artifacts, recomputes hashes, reads the DatasetCommitment PDA, and returns a field-by-field `VERIFIED` or `MISMATCH` result.
- One-command local stack and scripted Devnet demo preparation.
- End-to-end tests covering all 20 required demo steps with real network adapters and clearly separated opt-in live tests.
- Threat-model review, dependency audit, backup/restore test, object-access review, signer/authority runbook, and operational monitoring.

Exit criteria:

- The complete 20-step scenario succeeds live without prepared scrape payloads or database balance/grant simulation.
- Tampering with any local committed artifact makes verification return `MISMATCH`.
- Re-scrape produces a new version and cannot rewrite the version already sold.

## Critical path and sequencing

The critical path is:

`artifact/hash contracts → durable versioning → split-safe analysis → package → custom program → buyer auth/payment → protected delivery → proof verification`

Dependencies that must not be reversed:

- Do not publish commitments before canonical artifact formats are frozen.
- Do not build seat UI before Sale/AccessGrant accounts are authoritative.
- Do not expose buyer downloads before SIWS and server-side grant verification exist.
- Do not market `evidenceScore` as Alpha Score before the required component breakdown and leakage gate exist.
- Do not deploy the final program before adversarial local-validator tests pass; account layout changes after deployment require migration/versioning.

Frontend work can overlap phases 3–5 once the corresponding OpenAPI and account contracts are frozen. Discovery/ingestion and Anchor work can proceed in parallel after phase 0, but they converge at DatasetPackage creation.

## Suggested delivery slices

The detailed integration plan supersedes the initial estimate: allow **12–16 weeks for one senior engineer**, including external-provider and Devnet contingency, or **8–10 weeks for two focused engineers** splitting data/quant from Solana/full-stack work with scheduled quant and security review. The final integration path remains sequential where those tracks converge. Treat these as planning ranges until phase 0 decisions and live provider constraints are closed.

Recommended review milestones:

1. **Research-grade dataset** — phases 1–3 complete; no marketplace claim yet.
2. **On-chain package** — phase 4 complete; commitment and purchase pass on Devnet.
3. **Buyer-access MVP** — phases 5–6 complete; paid vs unpaid access demonstrable.
4. **Demo-ready MVP** — phase 7 complete; all 20 acceptance steps recorded in one run.

## Highest-risk issues

1. **Data licensing/resale rights** — public availability does not imply permission to resell raw or derived data. The canonical demo source needs an explicit compatible license and provenance record.
2. **False discovery** — automated feature/lag/target screening creates a multiple-testing problem. Train-only selection, an untouched test set, and false-discovery controls are essential to credible Proof-of-Alpha.
3. **Publication latency** — `available_at = observation timestamp` can silently create leakage. Unknown latency should fail closed or cap the score.
4. **On-chain/off-chain divergence** — database sale/grant caches must be reconciled from chain accounts/events and never authorize independently.
5. **Wallet replay/phishing** — nonce, domain, URI, chain, expiry, and address must all be verified server-side.
6. **Program account substitution** — every Anchor instruction needs seeds, owner, signer, relationship, and treasury constraints; client-supplied accounts cannot be trusted by position alone.
7. **Devnet reliability** — faucet/RPC limits can break a live demo. Use pre-funded wallets and a stable RPC, while still validating actual confirmed transactions.
8. **Single-node legacy migration** — the current encrypted state may contain useful work. Migration must be additive, backed up, and verified before retiring the file store.

## Definition of done

QARAU may be called MVP-complete only when a single recorded live run demonstrates all 20 steps from the supplied requirement, with:

- network evidence for discovery, source ingestion, market ingestion, and Solana transactions;
- immutable raw, normalized, manifest, and result artifacts with matching hashes;
- explicit train/validation/test and regime outputs;
- a deterministic Alpha Score breakdown;
- decoded DatasetCommitment, Sale, and AccessGrant accounts;
- a confirmed real Devnet SOL payment;
- successful buyer access and a 403 for an ungranted wallet;
- `VERIFIED` proof before tampering and `MISMATCH` after a controlled artifact mutation;
- a subsequent scrape producing a new immutable dataset version.

Until then, the accurate product label is **private research prototype**, not **end-to-end QARAU marketplace MVP**.

## Protocol references used for the target design

- [Solana Program Derived Addresses](https://solana.com/docs/core/pda) — deterministic PDA derivation and program-controlled accounts.
- [Solana: writing to the network](https://solana.com/docs/intro/quick-start/writing-to-network) — transaction atomicity, signer requirements, and SOL transfers.
- [Solana `getTransaction` RPC](https://solana.com/docs/rpc/http/gettransaction) — confirmed transaction lookup and execution metadata.
- [Anchor account constraints](https://www.anchor-lang.com/docs/references/account-constraints) — signer, seeds/bump, owner, address, and relationship validation.
- [Sign In With Solana specification](https://github.com/phantom/sign-in-with-solana) — standard wallet-authentication message, nonce, domain/chain/time binding, and server-side verification flow.

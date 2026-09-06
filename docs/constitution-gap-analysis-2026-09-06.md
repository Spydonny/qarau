# QARAU — Product Constitution conformance analysis

**ProofPilot run — evaluator mode**

| Field | Value |
|---|---|
| Mode | `evaluator` |
| Stages | `review` |
| Domains | web3/Solana, data/ML, AI |
| Venture type | startup (pre-revenue, hackathon-adjacent) |
| Program context | none asserted by the user; `.agents/skills/colosseum-copilot` present in-repo |
| Sensitivity | confidential — private codebase; no source content was sent to any external service |
| Rubric | `proofpilot/submission_readiness` v0.3.0 |
| Evidence cutoff | 2026-09-06T00:00:00Z |
| Artifact | working tree at commit `b5a0ec3` + 45 uncommitted paths |

**Criteria under evaluation:** the QARAU Product Constitution, §0–§91, as supplied by the
user. The Constitution — not a program's rules — is the eligibility document here.

**Evidence basis:** every finding below is a code, schema, or executed-test observation with
a file:line citation. No external market, competitor, or ecosystem claim is made, so no
external sources were required. ProofPilot references were retrieved 2026-09-06 from
`github.com/Marakaya/proofpilot` (`review.md`, `honest-evaluation.md`, `rubrics.json`).

---

## Headline finding: the Constitution and the frozen plan contradict each other

This outranks every individual gap, because it is not an implementation defect.

| Document | Position on auctions |
|---|---|
| Product Constitution §91.8 | *"Scarce access is allocated through auctions."* — listed as **non-negotiable** |
| Product Constitution §87 | *"Главная единица коммерциализации: Scarce Access Entitlement"* via auction |
| Product Constitution §23 | Auction is the mechanism that solves pricing of information of unknown value |
| Product Constitution §91.20 | The loop **DISCOVER → VALIDATE → AUCTION → ACCESS** must be preserved |
| `QARAU_MVP_INTEGRATION_PLAN.md:43` (D-02) | *"Timed fixed-price sale with minimum/fixed price; **no bidding engine**"* — frozen contract decision |
| `QARAU_MVP_INTEGRATION_PLAN.md:1206` | *"bidding auctions … remain explicitly out of scope"* |

The implementation faithfully executes D-02. It therefore violates the Constitution by
construction, not by oversight. A grep for `auction`, `bid`, `entitlement`, `winner` or
`clearing` across `server/`, `src/`, `programs/` and `infra/` returns **zero** matches
outside those two planning documents.

**This is a decision for the owner, not a bug to fix.** Either D-02 is reopened (it is
marked `Reversibility: Additive`, so it can be), or §17/§18/§22/§23/§71/§87/§91.8/§91.20
are amended. Leaving both documents standing means the project has no single answer to
"what is QARAU's commercialization mechanism".

---

## Rubric scores — `proofpilot/submission_readiness` v0.3.0

Scale 0–4. Zero means observed failure; missing evidence is recorded separately and never
scored as zero.

| Dimension | Weight | Score | Confidence | Basis |
|---|---|---|---|---|
| Criteria fit | 0.25 | **1** | High | 4 of 20 §91 non-negotiables are violated, including §91.8 and the §91.20 loop. Observed failure, not missing evidence. |
| Proof quality | 0.25 | **3** | High | Domain-separated hashes, on-chain hash verification, chain-read authorization, deterministic analytics, 69/69 integration tests executed. Deducted for two overstated claims (see Blockers B-04, and F-01/F-08 in `gap-audit-2026-09-06.md`). |
| Narrative clarity | 0.2 | **2** | High | The research pipeline reads exactly as §83/§84 require. The buyer surface reads as the §90 anti-pattern. |
| Completeness | 0.15 | **2** | High | discover→validate→package→access is complete end to end; auction, organizations, watermarking, signal health and revocation are absent. |
| Demo quality | 0.15 | **2** | Medium | The §66 golden demo breaks at steps 11–14. Steps 15–19 work. Live Devnet evidence bundle not captured (project's own acknowledgement). Not executed in a browser during this review. |

**Weighted score: 2.00 / 4 — Yellow.**

**Evidence coverage: ~80%** of dimensions verifiable from the repository were verified
directly. Coverage is **0%** for live-chain state and browser behaviour (see *Unresolved
unknowns*). The score reflects conformance to the Constitution as written; it is not a
judgement of commercial viability or of the engineering quality of what exists, which is
high.

---

## §91 non-negotiables — the twenty that cannot be violated

| # | Non-negotiable | Verdict | Evidence |
|---|---|---|---|
| 1 | QARAU discovers data itself | **Met** | `discovery/providers.mjs` — Data.gov v4 catalog search + `PublicCatalogDiscoveryProvider` + configurable web search; `discovery-run.mjs` persists candidates with provenance |
| 2 | Focused on physical alternative data | **Met** | `SOURCE_CATALOG` spans weather, water, energy, logistics, pollution, agriculture, mobility, retail, commodity infrastructure. No sentiment/news/SEC ingestion exists |
| 3 | Real quantitative validation | **Met** | `analysis/quantitative.mjs` — Pearson, Spearman, mutual information, 60/20/20 chronological splits, 3 regimes, 6 leakage checks |
| 4 | AI assists, does not replace statistical evidence | **Met** | The alpha score is computed only from `quantitative.mjs`; no LLM output touches it. (Over-met: see §8 row — the AI is absent from the production path entirely) |
| 5 | Most discovered sources should be rejected | **Partial** | Rejection exists (`analysis_status='rejected'`, `blocking_leakage`, `source_status='broken'`) but there is no source-level screening gate per §5 and no funnel surface — `FunnelTrace.tsx` is rendered by nothing |
| 6 | Derived value, not a directory of URLs | **Partial** | Normalization, derived signal transformations, quality metrics and validated packaging are real. But the delivered artifact is `normalized_object_key` — the cleaned series. No derived-feature bundle or update feed ships (§15) |
| 7 | Premium access is scarce | **Met** | `max_seats` / `occupied_seats` enforced in-program at `lib.rs:157`; `SeatsExhausted` |
| 8 | Scarce access allocated through auctions | **Violated** | No auction, bid, round, or clearing entity anywhere. `purchase` (`lib.rs:135`) is fixed-price, first-come-first-served |
| 9 | No third-party sellers | **Met** | No Seller/Vendor/Listing/Upload entity exists. Publication is owner-only through `requireOwner` |
| 10 | QARAU is not a marketplace | **Violated** | `src/pages/Marketplace.tsx`, `GET /api/v1/marketplace` (`v1.mjs:217`), and the copy *"The marketplace will only list commitment-backed sales"* (`Wallet.tsx:86`). §47 lists "Marketplace" as forbidden vocabulary |
| 11 | Customers purchase access rights, not ownership | **Met in model, violated in copy** | The model is correct — `AccessGrant` with tier, expiry, status. But `Wallet.tsx:86` renders `Buy early access`, which §71 explicitly forbids in favour of *"Bid for access"* |
| 12 | Solana verifies auction settlement and access rights | **Partial** | Access rights: fully verified on-chain. Auction settlement: not applicable — nothing to settle |
| 13 | Proprietary data private and off-chain | **Met** | Only 32-byte hashes reach the chain (`canonical-artifacts.mjs:HASH_DOMAINS`); payloads live in the private S3 store |
| 14 | Backend authorization depends on the real entitlement | **Met** | `v1.mjs:269` reads the grant from chain on **every** protected request; `registry-client.mjs:93` rejects `status != 1` or `expiresAt <= now` |
| 15 | A winning user can retrieve the real dataset | **Met** | `/dataset/:packageId/{metadata,report,data,export}` stream from the private store after `protectedContext` |
| 16 | A non-entitled user cannot retrieve it | **Met** | Same path — default-deny, `grant_access_denied` → 403. This is the §66 step-19 moment and it works |
| 17 | Every research result has data provenance | **Met** | `source → source_snapshots → dataset_versions → analysis_runs → signal_candidates` with a hash at every hop |
| 18 | Every conclusion traceable to real calculations | **Met** | `analysis_manifest` pins input hashes, pipeline version and settings; result hash is reproducible and fixture-pinned in both Rust and Node |
| 19 | Interface research-first, not ecommerce- or crypto-first | **Violated** | Buyer surface is a package grid with prices, "seats remaining" and a Buy button. §43 requires the primary action to be **View Research**, not Buy |
| 20 | Preserve DISCOVER → VALIDATE → AUCTION → ACCESS | **Violated** | The loop is DISCOVER → VALIDATE → **SELL** → ACCESS |

**Tally: 13 met, 3 partial, 4 violated.** All four violations trace to the same root: D-02.

---

## §65 — what may not be mocked

The Constitution names eleven things that must be real in any version. Ten are.

| # | Requirement | Real? | Evidence |
|---|---|---|---|
| 1 | Real external source | Yes | Chicago Beach Weather Stations JSON API; Data.gov v4 |
| 2 | Real data acquisition | Yes | `ingestion/fetch.mjs` — DNS-pinned, redirect-refusing, size-capped |
| 3 | Real processing | Yes | `normalization/canonical-jsonl.mjs` |
| 4 | Real statistical analysis | Yes | `analysis/quantitative.mjs` |
| 5 | Real validation result | Yes | `analysis_runs` + `validation_results` + `leakage_check_results` |
| 6 | Real generated data package | Yes | `dataset_packages`, sealed with 5 hashes |
| 7 | Real Solana transaction | Partial | Publish path implemented; program deployed. Live commitment/sale transactions not captured — project's own gate |
| 8 | **Real auction state** | **No** | Does not exist in any form |
| 9 | Real entitlement | Yes | `AccessGrant` PDA |
| 10 | Real authorization based on entitlement | Yes | `v1.mjs:269` |
| 11 | Real data retrieval | Yes | `/dataset/:packageId/data` |

---

## Full section-by-section conformance

`Met` · `Partial` · `Gap` (required, absent) · `Violated` (built the forbidden way) ·
`Deferred` (Constitution itself marks it "в идеальной версии" / §64-mockable)

### §1–§3 — Identity and focus

| § | Requirement | Verdict | Note |
|---|---|---|---|
| 1 | QARAU is a self-driving discovery→delivery system, not a catalog | Met | All ten listed capabilities have code; #8 (auction) is the exception |
| 2 | Forbidden entities: Seller, Vendor, Cart, Listing, Inventory, Seller Rating, Commission | Met | None exist |
| 2 | Required entities: Auction/Access Round, Seat, Bid, Winner, Access Entitlement | **Gap** | `Seat` exists as `max_seats`. `Auction`, `Bid`, `Winner`, `Entitlement` (as a named domain object) do not |
| 2 | Required entities: Source, Dataset Snapshot, Analysis Run, Signal Candidate, Validation Report, Data Package, Retrieval Event, Audit Record | Met | All present as tables |
| 2 | Required entity: `Data Opportunity` | Gap | No such object. `sources` and `analysis_runs` are separate; nothing binds them into a named opportunity |
| 3 | Physical-data specialization maintained | Met | Catalog is entirely physical-world; no sentiment/news/filings path |

### §4–§7 — Discovery, qualification, ingestion, quality

| § | Requirement | Verdict | Note |
|---|---|---|---|
| 4 | Discovery is real; user need not supply URLs | Met | `discovery.run` job; Data.gov v4 + catalog + configurable search |
| 4 | Per-candidate fields: URL, provider, timestamp, category, coverage, frequency, access method, licensing, usefulness, reasoning | Partial | URL (encrypted), provider, `discovered_at`, `expected_update_interval`, `temporal_coverage`, `source_type`, `license_status` present. **Missing: geographic coverage, estimated usefulness, discovery reasoning** — `reliability` stores only the provider and query string |
| 5 | Screening gates: availability, freshness, history, granularity, coverage, stability, cost, licensing, uniqueness, quant usability | **Gap** | No screening stage exists between discovery and scraping. A candidate goes `candidate → approved → active` by an owner button (`v1.mjs:123`); the ten gates are not computed. This is the largest missing stage in the pipeline |
| 6 | Real ingestion, raw stored separately from transformed | Met | `raw/…` and `normalized/…` prefixes; `putOnce` content-addressed |
| 6 | Lineage source → raw → transform → features → analysis → result | Met | Enforced by foreign keys and hashes |
| 7 | Quality metrics: missingness, duplicates, outliers, gaps, schema stability, frequency, coverage, distribution shifts, timestamp integrity | Partial | `missing_rate`, `outlier_rate`, `coverage_start/end`, row/field counts computed in `canonical-jsonl.mjs:74`. **Duplicates, schema stability, distribution shift, stale observations, cardinality are not** |
| 7 | A distinct Data Quality Score, with underlying metrics visible | Partial | `data_quality` exists as one weighted component of the alpha score (`quantitative.mjs`), not as a standalone score. Underlying metrics are persisted and viewable |

### §8–§10 — AI architecture

| § | Requirement | Verdict | Note |
|---|---|---|---|
| 8 | AI does discovery planning, hypothesis generation, feature suggestion, orchestration, interpretation, reporting | **Gap** | `analyzeSource` is imported by exactly one non-test file — `qarau-service.mjs:10`, the **legacy** runtime. `/api/v1` has no AI step at all |
| 9 | AI must not invent values, fake backtests, issue verdicts from text, or use LLM confidence as statistical confidence | Met | Structurally impossible: the analyzer's output never reaches the score. `validateAnalysis()` enforces exact key-set equality and clamps ranges |
| 10 | Six-agent pipeline (Discovery, Source Intelligence, Data Engineering, Quant Research, Critic/Validator, Report) around a deterministic analytics engine | **Gap** | One analyzer function exists, on the dead path. There is no Critic agent — the leakage checks in `quantitative.mjs` are deterministic rules, which is *better* evidence but is not the §10 Critic |
| 10 | Deterministic engine computes correlations, lags, lead-lag, regressions, MI, stability, regimes, walk-forward, significance, robustness | Partial | Pearson, Spearman, MI, lagged correlation, 3-way chronological split, 3 regimes, robustness, a p-value proxy. **No regression, no Granger-style test, no true walk-forward (a single 60/20/20 split, not expanding folds)** |

### §11–§14 — Market linkage, validation, output, filtering

| § | Requirement | Verdict | Note |
|---|---|---|---|
| 11 | Every opportunity is Dataset → Hypothesis → Target → Test → Result | Partial | Dataset → Target → Test → Result is enforced (`dataset_target_mappings`, `analysis_runs`). **Hypothesis is not a persisted object on the production path** |
| 12 | Temporal integrity | Met | `samples()` drops any row whose `availableAt` postdates the decision timestamp and counts the violations |
| 12 | Lead-lag | Met | Lags `[0,1,3,7]` × horizons `[1,3,7]`, forward returns only |
| 12 | Stability, regime robustness | Met | 3 regimes, sign-consistency in `robustness` |
| 12 | Statistical significance | Partial | `pValue()` is `exp(-|r|·√(n-2))` — a monotone heuristic, not a t-distribution tail. `p_value` and `q_value` are set to the same value; there is no multiple-testing correction despite ~1,176 candidates per run |
| 12 | Economic significance | Partial | `return_spread`, `sharpe_like`, `max_drawdown` computed, but nothing gates on them — the alpha score has no economic-significance component |
| 12 | Out-of-sample | Met | Test split untouched by orientation fitting |
| 12 | Leakage | Met | 6 typed checks, `block` zeroes the score |
| 13 | Structured report per opportunity with verdict and AI explanation *after* the numbers | Partial | `analysis/{id}/results.json` carries the numbers. **No narrative report, no verdict vocabulary, no explanation layer** |
| 14 | Value shown through rejection — the funnel | **Gap** | `FunnelTrace.tsx` implements exactly this and is **rendered by no page**; its only data source is `client.ts:145 → /api/research/runs/:id/lanes`, the legacy API. The funnel is dead code |

### §15–§16 — Packaging and moat

| § | Requirement | Verdict | Note |
|---|---|---|---|
| 15 | Package may include cleaned data, normalized data, derived features, snapshots, metadata, update feed, validation report, methodology, limitations, API endpoint | Partial | Ships: normalized data, private metadata, access policy, report object, API endpoints. **Missing: derived-feature bundle, update feed, methodology document, known-limitations document** |
| 16 | Value from discovery, cleaning, normalization, derived features, continuous updating, validation, packaging, provenance, access control | Partial | Seven of nine are real. **Derived features are computed during analysis but not delivered; continuous updating exists as a scheduler but the buyer receives a static version** |

### §17–§23 — Business model and auction

| § | Requirement | Verdict |
|---|---|---|
| 17 | Limited access auctions are core monetization | **Violated** — fixed-price sale |
| 18 | Auction states: upcoming, live, ended, settled, access granted | **Gap** — `Sale.status` has exactly two values, `STATUS_ACTIVE` / `STATUS_CLOSED` (`lib.rs:13`) |
| 18 | Auction has package, seats, open time, close time, bid requirements, settlement rule, state | Partial as a *sale* — package, seats, `starts_at`, `ends_at`, state exist. **No bid requirements, no settlement rule** |
| 19 | User buys an access entitlement, not ownership | Met in the data model |
| 20 | Auction close → winning bids → payment → entitlement → on-chain → retrieval enabled → losers get nothing | Partial | Payment → entitlement → on-chain → retrieval works atomically in `purchase`. **There are no bids and no winner determination** |
| 21 | Valid entitlements must equal the auction result | Met | `occupied_seats` is incremented in the same instruction as the transfer and the grant; a `checked_add` guards overflow |
| 22 | MVP may use one simple mechanic, e.g. Top N bids win | **Gap** — no mechanic at all |
| 23 | Auction discovers willingness to pay | **Gap** — price is set by the owner at `v1.mjs:203`, defaults 1,000,000 / 500,000 lamports |

### §24–§26 — Solana role

| § | Requirement | Verdict | Note |
|---|---|---|---|
| 24 | On-chain: auction identity/config, bids, settlement, winners, entitlement, payment evidence, access state, revocation, hashes, audit | Partial | Entitlement, payment evidence, access state, hashes, seat state: **on-chain**. Auction identity/config, bids, settlement, winners: **absent**. Revocation: `AccessGrant.status` field exists with no instruction to change it |
| 24 | Off-chain: raw data, datasets, features, methodology, payloads | Met | Strictly enforced |
| 25 | Solana provides verifiable scarcity, access ownership, settlement proof, payment link, auditability | Partial | Scarcity, ownership, payment link and auditability: yes. Settlement proof: nothing to prove |
| 26 | Not a gimmick — wallet → bid → settlement → entitlement → backend verifies → access | **Partial** | The chain is load-bearing: `readAccessGrant` gates every byte delivered. The flow is `wallet → purchase → entitlement → verify → access` — real, but missing the `bid → settlement` middle |

### §27–§30 — Identity, entitlement, authorization, audit

| § | Requirement | Verdict | Note |
|---|---|---|---|
| 27 | Account ↔ Wallet ↔ Organization | **Gap** | Zero occurrences of "organization" in the codebase. Only `user_wallets`; no account/org layer |
| 28 | Entitlement carries wallet, package id, tier, start, expiry, auction id, status | Partial | `AccessGrant` has wallet, `dataset_id_hash`, `purchased_version`, tier, `granted_at`, `expires_at`, status. **No auction id** (nothing to reference) |
| 28 | Backend checks entitlement before delivering | Met | `protectedContext` on every route |
| 29 | Flow: API → verify identity → map to wallet → check active entitlement → allow/deny; not a one-time check at purchase | **Met — and this is the strongest part of the build** | SIWS session → `readAccessGrant` from chain per request → `status`/`expiresAt` enforced at `registry-client.mjs:93` |
| 30 | Retrieval audit: who, which package, when, resource, decision; off-chain logs, periodic on-chain anchoring | Partial | `audit_events` records actor, wallet, action, resource, outcome on every read (`v1.mjs:272`). **No periodic hash anchoring of the log** |

### §31–§35 — Integrity, versioning, delivery, security

| § | Requirement | Verdict | Note |
|---|---|---|---|
| 31 | Snapshot hash anchored to package/version so the buyer can verify what they received | Met | `raw_snapshot_hash` + `normalized_dataset_hash` in `DatasetCommitment`; `POST /packages/:id/proof/verify` returns VERIFIED/MISMATCH/UNAVAILABLE |
| 32 | Package versioning distinct from product identity | Met | `datasets.id` (identity) vs `dataset_versions.version` (monotonic u32) |
| 33 | Real delivery: authenticated REST API + downloadable snapshots | Met | `/dataset/:packageId/data` streams NDJSON; `/export` sets `Content-Disposition` |
| 34 | Never public IPFS / public S3 / unauthorized URL | Met | Backend-only streaming from a private bucket; no signed public URL is ever minted |
| 35 | Encrypted transport, secure credentials, short-lived links, token rotation, wallet signature verification, expiration, rate limiting, audit, secret management, no keys in frontend | Partial | Wallet signature verification, access expiration, per-operation rate limiting (`operationLimit`), audit logs, no frontend keys: **yes**. **No API tokens at all** (session-cookie only), therefore no rotation; **no short-lived download links** (streaming instead, which is defensible); transport security delegated to the deployment |

### §36–§39 — Leak deterrence and buyers

| § | Requirement | Verdict |
|---|---|---|
| 36 | Do not claim blockchain prevents leaks | Met — no such claim appears in any document |
| 37 | Buyer-specific watermarking / fingerprinting | **Gap** — zero occurrences; every buyer receives byte-identical output |
| 38 | Revocation supported, historical record preserved | **Gap** — `access_grant_cache.status CHECK IN ('active','revoked','expired')` is a column with no writer; no on-chain revoke instruction |
| 39 | Organizations with users, wallets, API keys, seats, permissions | **Gap** — absent |

### §40–§47 — Interface and vocabulary

| § | Requirement | Verdict | Note |
|---|---|---|---|
| 40 | Feels like an institutional intelligence platform, not ecommerce | **Split** | The owner pipeline achieves this precisely. The buyer surface does not |
| 41 | Navigation: Discover / Opportunities / Auctions / My Access; Pipeline internal | **Gap** | `Nav.tsx:7` contains exactly one link: `{ to: "/pipeline", label: "Pipeline" }`. The four user-facing sections do not exist |
| 42 | Home shows recently discovered / validating / validated / upcoming rounds | Gap | No such page |
| 43 | Opportunity page is research-first; primary action **View Research** | **Violated** | No opportunity page. `Marketplace.tsx:62` shows price + seats; the action is Buy |
| 44 | Auction page with seats, deadline, minimum bid, methodology, access duration; action **Place Bid** | Gap | No auction page |
| 45 | My Access: entitlement status, expiry, endpoint, key management, downloads, version, history | Partial | `Wallet.tsx` lists grants via `/wallet/access-grants`. **No key management, no version display, no access history** |
| 46 | No crypto-first UX | Met | No token price, balance, NFT art, or explorer graphics |
| 47 | Vocabulary — use Opportunity/Auction/Bid/Entitlement; **never** Marketplace/Store/Cart/Listing | **Violated** | `src/pages/Marketplace.tsx`, `GET /api/v1/marketplace`, `publicPackage()`, and user-facing copy containing "marketplace" |

### §48–§57 — Lifecycle, provenance, monitoring, cockpit

| § | Requirement | Verdict | Note |
|---|---|---|---|
| 48 | Source lifecycle: Discovered → Screening → Acquiring → Processing → Testing → Validating → Rejected/Promising → Validated → Packaged | Partial | `source_status` = candidate, approved, active, broken, disabled. **No Screening, Testing, Validating, Promising or Validated state** — the research verdict lives on `analysis_runs`, not on the source |
| 48 | Package lifecycle: Draft → Ready → Auction Scheduled → Auction Live → Settled → Active Access → Expired | Partial | `package_status` = draft, sealed, commit_pending, committed, publication_failed. **No auction states, no Active Access, no Expired** |
| 49 | Rejection is permanent research knowledge — why, which test, when, on what data | Partial | `leakage_check_results` stores type, status, penalty and explanation per candidate, and rejected runs persist. **Rejected *sources* keep no reason; there is no re-validation trigger when a source changes** |
| 50 | Continuous validation after sale: quality, freshness, availability, decay, schema change | **Gap** | The scheduler re-scrapes, but nothing re-validates a sold package |
| 51 | Signal Health: Stable / Weakening / Degraded / Broken, reported honestly | **Gap** | No such concept in the schema or code |
| 52 | Full provenance walk: verdict → metrics → run → features → processed → raw → source | Met | Every hop is a foreign key with a hash; signal artifacts are persisted per candidate |
| 53 | Specific, non-generic explanations | **Gap** | No explanation layer ships on the production path |
| 54 | No invented percentages; use Strong/Moderate/Weak/Rejected + metrics | **Partial → at risk** | Metrics are honest and shown. But the surfaced number is `Alpha score {n}` on a 0–100 scale (`Marketplace.tsx:62`), which is exactly the "one beautiful arbitrary score" §7 warns against. The evidence-band vocabulary of §54 is not used anywhere |
| 55 | High recall in discovery → high precision after validation | Partial | Discovery is broad. The precision stage exists but the screening funnel of §5 does not, so recall is not yet paid for by cheap rejection |
| 56 | Analyst can approve hypothesis, change target, rerun, flag source, override publication | Partial | Owner can approve a source, choose a target, rerun analysis, seal and publish. **Cannot flag a bad source, cannot approve a hypothesis (none exist)** |
| 57 | Admin cockpit shows the funnel: 742 discovered / 126 accessible / 31 analyzing / 8 promising / 2 validated | **Gap** | `Pipeline.tsx` is a linear six-step wizard for **one** source. There is no aggregate funnel view; `FunnelTrace.tsx` exists and is unused |

### §58–§63 — Metrics, moat, flywheel

| § | Requirement | Verdict | Note |
|---|---|---|---|
| 58 | Product metrics across discovery, filtering, research, commercial, data | **Gap** | No metrics aggregation exists. `pipeline_stage_runs` was created for stage timing (`0001_initial.sql:426`) and has no reader or writer |
| 59 | Do not adopt marketplace KPIs | Met | None are computed — vacuously satisfied |
| 60 | Moat: discovery history, validation corpus, specialization, pipeline, engineering, buyer demand | Partial | Discovery history, validation corpus, specialization and pipeline accumulate correctly. **Buyer-demand information cannot accumulate without bids** |
| 61 | Feedback loop: auction bids become a training signal for discovery ranking | **Gap** | Structurally impossible without §17 |
| 62 | Ranking model over quality, novelty, evidence, stability, cost, exclusivity, demand | **Gap** | No ranking exists; `/marketplace` orders by `created_at DESC` |
| 63 | Business flywheel | **Gap** | Broken at the same link as §61 |

### §64–§66 — MVP scope and demo

| § | Requirement | Verdict |
|---|---|---|
| 64 | Permitted simplifications | Met — the build stays well inside them |
| 65 | Eleven things that must be real | 10 of 11; **auction state absent** |
| 66 | Golden demo, 19 steps | Steps 1–10 and 15–19 are executable. **Steps 11–14 (3 seats offered → bids → Solana settles → winners) cannot be demonstrated** |

### §67–§75 — Architecture, licensing, payment

| § | Requirement | Verdict | Note |
|---|---|---|---|
| 67 | The 13-layer architecture, never frontend→LLM→database | **Met, with one hole** | Every layer exists as a separate process or module — except `AUCTION ENGINE`, which is absent between DATA PACKAGE and SOLANA SETTLEMENT |
| 68 | Separation: AI / quant engine / backend / database / Solana / storage | Met | Cleanly separated; enforced at startup by `loadServiceConfig` role contracts |
| 69 | Licensing tracked per source; derived-only sale when redistribution is barred | Partial | `license_status`, `redistribution_rights`, `derivative_rights`, `license_evidence_object_key` exist and are set at approval (`v1.mjs:125`). **Nothing reads them** — packaging and publication do not check redistribution rights before selling the normalized data |
| 70 | Distinguish source ownership / QARAU product / customer access rights | Partial | True in the data model. Not expressed in the UI |
| 71 | Never "Buy this dataset"; prefer "Bid for access" | **Violated** | `Wallet.tsx:86`: `Buy ${tier} access` |
| 72 | Production auth: user, organization, wallet, signed verification, session, permissions | Partial | Owner password auth + SIWS wallet sessions + CSRF. **No organization, no permission system** |
| 73 | Four authorization levels: platform, auction, package, API | Partial | Platform (owner) and package (entitlement) exist. **Auction permission is N/A; API-level permissions/rate tiers do not exist** |
| 74 | Payment → settlement → entitlement matters more than the asset | Met | SOL transfer and grant creation are one atomic instruction |
| 75 | No token unless it solves a separate economic problem | Met | No token |

### §76–§79 — Privacy

| § | Requirement | Verdict | Note |
|---|---|---|---|
| 76 | Never publicly expose data contents, customer strategy, consumption patterns, research interests | Met | Only hashes on chain; `NON_SENSITIVE_PUBLIC_FIELDS` gates the public projection; source URLs are ciphertext at rest |
| 77 | wallet ↔ organization mapping stays private | N/A | No organization layer exists to map |
| 78 | Bid book privacy / sealed bids possible later | N/A | No bids |
| 79 | Anti-front-running may be a future requirement | N/A | No bids |

### §80–§90 — Reliability, honesty, product promise

| § | Requirement | Verdict | Note |
|---|---|---|---|
| 80 | Feed shows last updated, expected frequency, current health, missing-update indicator | Partial | `expected_update_interval`, `next_scrape_at`, `consecutive_failures` and a `broken` state exist server-side. **None is surfaced to a buyer** |
| 81 | SLA direction: uptime, latency, support, version policy, incident notification | Gap | Not started — reasonable for this stage |
| 82 | Real simple statistics beat fake sophistication | **Met — a genuine strength** | The engine does real, auditable work and refuses to over-claim: `instantaneous_strength > 0.95` **blocks** rather than boosts |
| 83 | One question per screen | Partial | `Pipeline.tsx` mixes six pipeline stages on one screen |
| 84 | Status honesty: Analyzing / Inconclusive / Rejected — not "High Alpha Potential" everywhere | Partial | Statuses are honest at the DB level (`rejected`, `failed`, `blocking_leakage`). But the only buyer-visible signal is a 0–100 Alpha score with no band vocabulary |
| 85 | Save the researcher search time and research time | Met in principle | The pipeline does exactly this — but no user-facing surface delivers it (§41) |
| 86 | Main unit of value = Validated Data Opportunity | **Gap** | No `Opportunity` object exists; value is fragmented across `sources`, `analysis_runs` and `dataset_packages` |
| 87 | Main commercial unit = Scarce Access Entitlement via auction | Partial | Scarce entitlement: yes. Via auction: no |
| 88 | Main blockchain entity = Verifiable Entitlement, not NFT theatre | **Met — the best-executed principle in the build** | `AccessGrant` is load-bearing: no grant, no bytes |
| 89 | Main AI entity = Research Hypothesis + Evidence | **Gap** | Evidence is excellent; the hypothesis object does not exist on the production path |
| 90 | Must not be describable as "an AI marketplace where users browse and buy alternative datasets using Solana" | **Violated** | That sentence currently describes the buyer-facing product accurately, including the word "marketplace" |

---

## Findings

### Blockers

**B-01 — The auction does not exist (§17, 18, 20, 22, 23, 61, 62, 63, 65.8, 66.11–14, 71, 87, 91.8, 91.20).**
Not a missing feature: a missing *layer* of the §67 architecture. It also disables the §61
feedback loop and the §60 buyer-demand moat, which are the Constitution's long-term thesis.
Root cause is the frozen decision D-02, so the first action is a governance decision, not code.

**B-02 — The product presents itself as the §90 anti-pattern.**
`src/pages/Marketplace.tsx`, `GET /api/v1/marketplace`, "seats remaining · N lamports",
and a `Buy early access` button. §47 forbids the word, §71 forbids the phrasing, §43
requires **View Research** as the primary action. This is the cheapest blocker to fix and
the one most visible to any evaluator.

**B-03 — No source screening stage (§5, §48, §55, §57).**
Discovery → owner approval → scrape. The ten §5 gates are not computed, so the
"reject 98% cheaply" claim (§14) is not mechanised — rejection currently happens only
*after* full ingestion and analysis, which is the expensive end. `FunnelTrace.tsx` — the
component built to show precisely this — is rendered by nothing.

**B-04 — The user-facing product has no navigation (§41–§45).**
`Nav.tsx:7` has one link, `/pipeline`. Discover, Opportunities, Auctions and My Access do
not exist. Everything §85 promises the researcher is implemented server-side and
unreachable.

**B-05 — The AI layer is not in the shipping runtime (§8, §10, §11, §13, §53, §89).**
`analyzeSource` is reachable only through the legacy `/api/qarau` API. The production
pipeline has no hypothesis object, no interpretation, and no report. §9 is satisfied — but
by absence, not by design.

### Quick wins

| Action | Sections | Effort |
|---|---|---|
| Rename `Marketplace` → `Access Rounds`/`Opportunities` across page, route and API path; change `Buy … access` → `Bid for access` / `Request access`; make the card's primary action **View Research** | 43, 47, 71, 90 | Hours |
| Render `FunnelTrace.tsx` on an owner cockpit page fed by a `/api/v1` aggregate count query | 14, 57 | Hours |
| Replace the bare `Alpha score 87` with a band — Strong / Moderate / Weak / Rejected — plus the existing component breakdown | 7, 54, 84 | Hours |
| Gate packaging on `sources.redistribution_rights` and `license_status='approved'`; the columns already exist and are already populated | 69 | Hours |
| Add `hypothesis` text + `target_rationale` to `analysis_runs` and persist the analyzer output alongside the numbers | 11, 89 | ~1 day |
| Surface freshness on the buyer card from the `next_scrape_at` / `consecutive_failures` data already stored | 80 | Hours |

### Unresolved unknowns

Recorded as unknown, **not** scored as failure:

- **Live Devnet state.** No RPC call was made. Whether `Registry` is initialized, whether any `DatasetCommitment`/`Sale` exists, and whether deployed bytecode matches source are unverified.
- **Browser behaviour.** No page was rendered. All UI findings are from source.
- **`cargo test` execution.** Test content read from source; suite not run this session.
- **Program owner's intent on D-02.** Whether the Constitution supersedes the plan is the user's call and was not assumed either way.

---

## Recommendation

**Verdict: `revise` — do not treat the current build as Constitution-conformant.**

The engineering underneath is stronger than the conformance score suggests. §29 (per-request
chain-verified authorization), §88 (load-bearing entitlement), §82 (honest statistics that
block instead of flatter), §31 (buyer-verifiable integrity) and §13/§76 (privacy boundary)
are executed at a standard most projects at this stage do not reach. The problem is not
quality; it is that the **commercial mechanism and the entire user-facing surface belong to
a different product than the one the Constitution describes**.

**Smallest useful next step, before any new feature:** resolve D-02 versus §91.8 in writing.
One sentence in `QARAU_MVP_INTEGRATION_PLAN.md` either reopens the auction decision or
amends the Constitution.

**Then, if the auction stays:** the thinnest real §22 mechanic — an `access_rounds` table, a
`bids` table, a `settle` instruction that writes N `AccessGrant`s for the top N bids, and
"Top N bids win". This is what turns §65.8 from absent to real and makes the §66 demo
complete end to end.

- **Success threshold:** the §66 golden demo runs all 19 steps against Devnet, with step 19 (a losing wallet denied) captured as evidence.
- **Stop / pivot condition:** if a working auction cannot be delivered in the available time, amend the Constitution to describe a fixed-price scarce-seat sale — and change §47/§71 vocabulary to match. Shipping a fixed-price sale while the Constitution claims auctions is the one outcome that is worse than either choice.

---

*ProofPilot `submission_readiness` v0.3.0 · evaluator mode · evidence cutoff 2026-09-06T00:00:00Z ·
weighted score 2.00/4 (Yellow) · coverage ~80% of repository-verifiable dimensions, 0% of live-chain dimensions.
A rubric score reflects the criteria evaluated — here, conformance to the supplied Constitution —
not commercial viability or admission likelihood.*

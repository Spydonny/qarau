# QARAU MVP implementation status

Last updated: 2026-09-06

## Current verdict

**Local integrated demonstration: ready. Full Devnet acceptance: waiting on live
business-state transactions and a human-controlled buyer signature.**

The durable `/api/v1` path now owns the authenticated UI. Discovery, ten-gate
screening, exact-byte ingestion, immutable normalized versions, chronological
analysis, leakage controls, package sealing, public research opportunities,
Top-N access rounds, SIWS, protected licensed delivery, the isolated publisher
signer, and the Anchor program are implemented.
The legacy pages are no longer reachable from owner navigation or routes.

Program `63VZwKUPcWqo2JwpQHLxT4HHgQsMREpERZg3DpfSnnMw` remains the configured
Devnet address. The new release binary is built and verified locally; the
Devnet upgrade still requires the Solana CLI and a funded upgrade authority.
Deployment alone is not evidence of the state machine: registry initialization,
commitment, access round, ranked bids, settlement, finalized AccessEntitlement,
allowed delivery, and denied delivery must be captured end to end.

## Delivery waves

| Wave | Scope | Status | Remaining gate |
|---|---|---|---|
| 0 | Contracts, ADRs, topology and tracer | Implemented | Turn the 20-step tracer into a captured live evidence bundle. |
| 1 | PostgreSQL, immutable artifacts and durable jobs | Implemented | None for local acceptance. |
| 2 | Discovery, ingestion and immutable versions | Implemented | None for local acceptance. |
| 3 | Quantitative pipeline | Implemented | None for local acceptance. |
| 4 | Package and Solana control state | Implemented locally; Devnet upgrade pending | Upgrade program, initialize registry, commit package and open an access round. |
| 5 | Wallet, bids, entitlements and delivery | Implemented locally; live proof pending | Human bidder signs Devnet bid; settle, claim/refund, and verify both authorization outcomes. |
| 6 | Opportunities, proof and owner UI | Implemented | Public opportunities populate after a finalized access round. |
| 7 | Acceptance, hardening and cutover | In progress | Capture the full Devnet evidence bundle and rerun ProofPilot. |

## Verified implementation

- The authenticated interface uses only `/api/v1`; legacy URLs redirect to the
  durable pipeline.
- Analysis results are server-paginated (20 by default, 100 maximum), validation
  rows are limited to the visible signals, and leakage checks are aggregated.
- Analysis responses restore their existing package; repeated package creation
  is idempotent at the API boundary and the UI does not offer a second seal.
- The production image contains `contracts/`; CSP no longer blocks fonts or
  React layout styles.
- Devnet publication is resumable after `publication_failed`; active retries are
  deduplicated and previously chosen auction terms are reused.
- Integration tests use a disposable `qarau_test` database. A guard refuses any
  `TEST_DATABASE_URL` whose database name is not explicitly a test database.
- The working PostgreSQL database contains no `example.test` sources after the
  targeted fixture cleanup.

## Latest verification

- Node unit and isolated PostgreSQL integration tests: **74/74 passed**, 0 skipped with the disposable test database.
- TypeScript/Vite production build: passed.
- Rust/Anchor: format, Clippy with warnings denied, 9/9 contract tests passed; release SBF binary rebuilt.
- Production dependency audit: 0 known vulnerabilities.
- Production container full suite: **68/68 passed** inside the runtime image.
- Devnet program upgrade: pending CLI availability; live registry/commitment/round/bid/settlement chain is intentionally not claimed as complete.

See `docs/proofpilot-review.md` for the evidence review and release threshold.

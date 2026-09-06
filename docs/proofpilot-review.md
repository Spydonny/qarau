# QARAU MVP — ProofPilot evidence review

**Review date:** 2026-09-06  
**Mode/stage:** coach, technical review  
**Scope:** the local integrated QARAU MVP and its safe, off-chain end-to-end path.

## Result

**ProofPilot verdict: `ready` for a local integrated
demonstration.** The off-chain path was exercised against real public data and
persisted durable, immutable artifacts. The Anchor program is deployed on
Devnet. A live commitment, sale, wallet purchase and AccessGrant are not claimed
until their transactions and authorization outcomes are captured.

## Evidence snapshot

| Capability | Evidence | Result |
|---|---|---|
| Source discovery | 18 non-fixture sources retained from the public catalog; all `example.test` records were removed | Pass |
| Live source ingestion | Chicago Beach Weather Stations JSON API retrieved, exact body stored, parsed and sealed as immutable dataset versions 1 and 2 | Pass |
| Market target | Coinbase BTC/USD daily candles retrieved (299 rows) and stored as a frozen market snapshot | Pass |
| Quantitative validation | Run `dbd445e1-2ef4-4168-abc6-d87236ecbb6b`: 1,176 signal candidates, 6,696 validation records, 7,056 leakage checks; completed without blocking leakage | Pass |
| Package sealing | Package `281d1ccf-dad7-4346-a1df-8d3516fe3c7e` sealed with raw, normalized, manifest, result, and access-policy hashes | Pass |
| Runtime reliability | Long analysis job lease renewal is unit-tested; worker is idempotent on redelivery after durable completion | Pass |
| Tests and build | Node and isolated PostgreSQL integration suite 68/68; Rust format, Clippy, and 7 contract tests passed | Pass |
| Dependency/runtime checks | Production dependency audit reported 0 vulnerabilities; Docker Compose API and dependent services healthy | Pass |
| Devnet program deployment | Program `63VZwKUPcWqo2JwpQHLxT4HHgQsMREpERZg3DpfSnnMw` deployed in slot `493885442`; owned by BPF Upgradeable Loader with the separate publisher authority | Pass |
| Devnet registry, commitment, sale, and wallet payment | Not run: these create live product state and require a buyer wallet signature | Explicit external gate |

## Source evidence

- Dataset endpoint: `https://data.cityofchicago.org/resource/k7hf-8y75.json?$limit=10000` — retrieved 2026-09-05.
- Market endpoint: `https://api.exchange.coinbase.com/products/BTC-USD/candles` — retrieved 2026-09-06.
- Data.gov V4 authentication/rate limit behavior was handled by the discovery fallback; the fallback source catalog was used when the shared demo key was rate limited.

## Findings fixed during review

1. Coinbase requests lacked a descriptive User-Agent; market retrieval now supplies one.
2. The analysis worker lacked outbound egress while it retrieves public market
   data; its role now has the isolated egress network.
3. API storage permissions were read-only even though owner actions must seal
   market snapshots and packages; they are now least-privilege read plus writes
   limited to market and package prefixes.
4. A long analysis could outlive the queue lease; workers now renew leases and
   acknowledge a redelivered completed analysis safely.
5. Source scheduling now excludes a source that already has a queued/running
   scrape, avoiding a scheduler/manual-scrape race.
6. Owner navigation and routes now use only the durable `/api/v1` pipeline;
   legacy screens redirect instead of presenting a second store.
7. Analysis payloads are paginated and leakage checks aggregated; the package
   state is restored on reload and package creation is idempotent.
8. The production image includes frozen contracts, and CSP no longer blocks
   the document font/style path.
9. Database tests run against a disposable `qarau_test` instance and refuse a
   production-shaped database URL. Existing `example.test` fixtures were removed
   with a scoped transactional cleanup.
10. Devnet publication resumes from `publication_failed`, reuses the original
    sale parameters, and deduplicates active publish jobs.

## Release gate

**Success threshold for the final on-chain acceptance:** on Devnet, the deployed
program initializes its registry, accepts one authorized commitment, creates an active sale, accepts a
wallet-signed payment within its seat/time/tier limits, writes an access grant,
and allows only that grant holder to retrieve the permitted package version.

**Stop condition:** do not create a sale or request any buyer wallet signature
until the operator explicitly authorizes that live acceptance flow and provides
a separate human-controlled test wallet. If commitment hashes or access checks
differ from the local sealed package, stop and investigate rather than releasing.

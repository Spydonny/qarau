# QARAU / Internal

QARAU is an owner-only discovery and research workbench for testing whether
physical-world data adds out-of-sample predictive information to a financial target.
It discovers and normalizes sources, generates hypotheses, ranks candidates, runs
leakage-safe tests, and batches private provenance into Solana Merkle-root commitments.

The app uses live provider data, never generated market or weather fallbacks. A result is
research evidence, not investment advice or a claim of durable alpha.

## Architecture

- React/TypeScript reuses the existing QARAU interface.
- Express exposes authenticated REST APIs, bounded background jobs, rate limits, and
  server-side owner sessions.
- Provider adapters fetch public data through a DNS-pinned SSRF boundary.
- Immutable source/target snapshots and research records are stored in one AES-256-GCM
  encrypted local state file for this single-node MVP.
- The semantic analyzer is local by default. An optional OpenAI-compatible adapter gets
  only an `AI_SAFE` abstraction and must return a strict JSON schema.
- Alpha Lab runs predetermined statistical operations over exact snapshot IDs.
- A child signer accepts only `{ action, root, epoch, version }` and can write a batched
  root to Solana Devnet. It has no access to source URLs, datasets, or hypotheses.

Long-running parse, provider-connect, JSON-connect, and Alpha Test requests use persisted
`QUEUED -> RUNNING -> COMPLETE/FAILED` jobs. The browser polls `/api/qarau/jobs/{id}`.

## Run locally

```bash
npm install
npm run auth:hash -- 'a-long-password-you-choose'
```

Put the printed `OWNER_PASSWORD_HASH=...` line in `.env`, using `.env.example` as the
template, then run:

```bash
npm run dev
```

- App: http://localhost:5173
- API: http://localhost:8787
- Health: http://localhost:8787/api/health
- OpenAPI description: http://localhost:8787/api/openapi.json
- Owner ID: `01` by default

If no password hash is configured, QARAU creates a one-process random password and prints
it once. It changes at restart. To run the built app from one origin, use
`npm run build && npm start` and open http://localhost:8787.

Docker runs the same built single-node MVP and persists its encrypted private volume:

```bash
docker compose up --build
```

The repository is now migrating through the staged integration plan. Node.js 24 and the
root `package-lock.json` are authoritative for the API, workers, scheduler, and isolated
publisher signer. `docker compose up --build` starts PostgreSQL, private object storage,
the compatibility API, and the Wave 0 process foundations. Worker capabilities remain
explicitly `foundation-only` until their durable handlers land in later waves.

See `docs/runtime/services.md`, `docs/runtime/credential-matrix.md`, and
`QARAU_MVP_INTEGRATION_PLAN.md` for service boundaries and the delivery sequence.

## Discovery and ingestion

`PUBLIC_CATALOG` is the built-in public dataset/catalog provider. Running discovery is
idempotent and registers real Open-Meteo, USGS, and World Bank sources across weather,
water, energy, logistics, pollution, agriculture, mobility, retail, and commodity
infrastructure. It acts as the realistic demo seed; it does not pre-label any source as
alpha and does not download data until **Connect provider** is used.

`WEB_SEARCH` is a bounded configurable interface. Set `WEB_SEARCH_ENDPOINT_TEMPLATE`
with a `{query}` placeholder and optionally `WEB_SEARCH_API_KEY`. It accepts at most 20
results per job and does not crawl recursively.

Other supported inputs are manual URL, manual JSON API, source CSV, and target CSV. The
registry deduplicates normalized URLs plus catalog identity. Every successful ingestion
stores provider provenance, observation/availability times, actual receipt time, quality
diagnostics, and an exact SHA-256 snapshot digest. Severe malformed input is rejected;
warnings cover short history, jumps, gaps, repetition, distribution shifts, future
timestamps, and unverified latency.

The server ensures the public catalog exists at startup. For an explicit idempotent seed
command while the server is stopped, run `npm run seed`.

Market targets use replaceable adapters:

- ECB: `EURUSD`, `EURGBP`, `EURJPY`, and `EURCHF`.
- Alpha Vantage: a validated custom US equity symbol when
  `ALPHA_VANTAGE_API_KEY` is configured.
- Target CSV fallback with `timestamp,price` columns.

## AI analysis

The local analyzer is the secure default (`AI_PROVIDER=local`). It produces a structured
phenomenon, industries, asset classes, candidate targets, causal chain, lag range,
confounders, leakage risks, information rationale, additional validation needs,
confidence, and tags. It never decides profitability.

For `AI_PROVIDER=openai-compatible`, also set `AI_BASE_URL`, `AI_MODEL`, and `AI_API_KEY`.
Only `PUBLIC_SOURCE` records are eligible. Private URLs, exact geography, datasets,
identifiers, target mappings, and Alpha results are excluded. `PRIVATE_SOURCE` and
`HIGHLY_SENSITIVE_SOURCE` records fail closed for external AI. Source text is explicitly
marked untrusted, the model has no tools, and unknown output fields are rejected.

## Alpha Lab

Alpha Lab aligns immutable source and market snapshots and permits a value only when
`available_at <= prediction_time`. It calculates Pearson/Spearman correlation by lag,
mutual information, cross-correlation, three expanding walk-forward folds, and explainable
ridge-linear baseline/augmented models. Scaling is fitted inside each training fold.

Results include out-of-sample R-squared, MAE, directional accuracy, delta, best lag,
sample size, fold stability, warnings, and a 0-100 evidence score. A suspiciously perfect
relationship raises review severity instead of receiving automatic trust.

## Private state and ownership

The registry exposes broad source facts in the normal owner UI while exact URL, raw
snapshots, hypotheses, target mappings, and statistics remain encrypted private state.
Every completed test retains source/target snapshot IDs, code/config/model versions, and
creation time.

Provider control is an off-chain workflow with `UNCLAIMED`, `PENDING_VERIFICATION`,
`VERIFIED`, and `REJECTED` states. The MVP includes nonce challenges and an owner admin
decision. Private access receipts are salted hashes; neither provider identity nor access
mapping is added to the public provenance transaction.

## Solana Devnet

Source and analysis records use separate canonical domains, random 32-byte salts, and
private Merkle proofs. At a configurable fixed cadence (`COMMITMENT_EPOCH_MINUTES`, default
six hours), only epoch, schema version, and Merkle root leave QARAU. Immediate mode exists
only when `DEV_ALLOW_IMMEDIATE_COMMIT=true`.

Show the operational Devnet address without exposing its key:

```bash
npm run signer:address
```

Fund that address with a small amount of Devnet SOL. `DEV_AUTO_AIRDROP=true` permits the
isolated signer to request test SOL, but public faucet rate limits may still require manual
funding. The key and idempotency ledger live under ignored `server/data/private/signer/`.
The signer is Devnet-only, Memo-program allowlisted, limited to 24 transactions/day, uses
preflight, and waits for confirmation. Failed signing leaves commitments queued.

The repository also contains the `qarau_registry` Anchor program. It creates one authority
registry PDA and immutable epoch-root PDAs, validates authority/schema/PDA constraints,
and rejects duplicate epochs through `init`.

```bash
npm run check:anchor
npm run test:anchor
# With Anchor/Solana CLI installed and a funded Devnet deployment authority:
anchor build
anchor deploy --provider.cluster devnet
```

`Anchor.toml` records the current Devnet program ID and development authority path. The
program is compiled and tested here but is not deployed automatically. The operational
MVP transport uses the standard Memo program until deployment is explicitly completed.

## Demo flow

1. Log in and open **Data**.
2. Run bounded public-catalog discovery or add a URL/API/CSV source.
3. Filter/sort the registry and open a source.
4. Parse it, run structured analysis, and review scores/risks.
5. Connect a real provider snapshot or upload source data.
6. Choose ECB/custom-equity/CSV target, lag range, and prediction horizon.
7. Run Alpha Test and inspect fold metrics and leakage warnings.
8. Queue source and analysis provenance.
9. Let the fixed epoch run, or use immediate development mode.
10. Only after a real confirmed Devnet transaction does the UI show a signature and
    `COMMITTED_ONCHAIN`.

## Verification

```bash
npm test
npm run lint
npm run build
npm run check:anchor
npm run test:anchor
npm audit
```

See `SECURITY.md` for enforced boundaries, compromise scenarios, and the production work
still required before QARAU can custody production alpha or funds.

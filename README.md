# QARAU — verifiable research access on Solana Devnet

QARAU turns licensed physical-world data into leakage-safe quantitative research, then
allocates access through transparent Top-N rounds. The buyer-facing catalog exposes only
safe evidence and the Devnet commitment; source URLs, raw datasets, hypotheses and
statistics stay in the private trust domain. A winner claims a wallet-bound entitlement
before reading the authorized artifact.

This is research infrastructure, not investment advice or a claim of durable alpha.

## Reviewer demo (no wallet or SOL required)

```bash
npm install
npm run dev
```

Open http://localhost:5173/opportunities (or add `?demo=1`). Choose **My Access**,
select **Continue as demo bidder**, place one bid, wait 30 seconds, then claim it. The
delivered research panel, export, and proof UI will appear. Demo mode is explicitly local:
it creates no wallet transaction, moves no SOL, and must not be presented as Devnet proof.

For live rounds, use `?demo=0`, a Wallet Standard Devnet wallet, and the integrated runtime
described below. One wallet can place only one irreversible bid per access round; after
settlement it either claims its entitlement or refunds a losing bid.

## Architecture

- React/TypeScript provides public discovery, auctions, proof, wallet access and the
  owner workbench.
- Express exposes authenticated REST APIs, bounded background jobs, owner sessions and
  Sign-In With Solana wallet sessions.
- Provider adapters fetch public data through a DNS-pinned SSRF boundary.
- `legacy` mode uses one AES-256-GCM encrypted state file. `integrated` mode uses
  PostgreSQL plus private S3-compatible object storage and mounts `/api/v1`.
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

- App: http://localhost:5173 (legacy owner UI plus local reviewer demo)
- API: http://localhost:8787
- Health: http://localhost:8787/api/health
- OpenAPI description: http://localhost:8787/api/openapi.json
- Owner ID: `01` by default

If no password hash is configured, QARAU creates a one-process random password and prints
it once. It changes at restart. To run the built app from one origin, use
`npm run build && npm start` and open http://localhost:8787.

### Integrated runtime (real `/api/v1` pipeline)

The compose stack has a migration job intentionally separated from normal services. Run it
once before starting the workers; otherwise PostgreSQL roles exist but the schema does not.

```bash
docker compose up -d --build postgres object-storage object-storage-init
docker compose --profile tools run --rm migrate
docker compose up -d --build
```

Open http://localhost:8787 after the stack is healthy. Node.js 24 and the root
`package-lock.json` are authoritative for all local processes. Set
`QARAU_WORKER_EXECUTE=true` only for roles whose real external credentials have been
configured; workers otherwise report `foundation-only` and intentionally idle.

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

The current program ID is
[`63VZwKUPcWqo2JwpQHLxT4HHgQsMREpERZg3DpfSnnMw`](https://explorer.solana.com/address/63VZwKUPcWqo2JwpQHLxT4HHgQsMREpERZg3DpfSnnMw?cluster=devnet).
It stores only domain-separated artifact hashes and implements dataset commitments, access
rounds, deterministic Top-N settlement, bids, entitlements and losing-bid refunds.

Show the operational Devnet address without exposing its key:

```bash
npm run signer:address
```

Fund that address with a small amount of Devnet SOL. The key and idempotency ledger live
under ignored `server/data/private/signer/`. The signer is Devnet-only and receives only a
bounded publish intent; it has no source URLs, datasets, or hypotheses. Failed signing
leaves commitments queued.

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
program is not deployed automatically. Before a live publish, verify that
`npm run signer:address` matches the registry authority on Devnet. In the current checked
deployment they differ, so publishing new commitments is intentionally blocked until the
original authority is recovered or a new registry/program deployment is initialized. This
is a real deployment prerequisite, not something demo mode simulates.

## End-to-end owner flow

1. Discover and screen a source; approve license redistribution or derivative rights.
2. Ingest it through the DNS-pinned fetch boundary and seal a normalized dataset version.
3. Run analysis against a market target. Blocking leakage prevents packaging.
4. Seal a package, publish its hash commitment and access round through the isolated signer.
5. Reconcile finalized Devnet state, then expose the public opportunity.
6. Wallet users bid, the round settles Top-N, winners claim and read only their entitled data.

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

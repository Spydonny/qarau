# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

QARAU: an owner-only research workbench that discovers external ("physical world") data
sources, runs leakage-safe statistical validation against a financial target, and commits
only artifact **hashes** to Solana Devnet. Validated research is then allocated through
transparent Top-N access rounds; winners claim on-chain entitlements.

The hard rule that shapes most of the code: **nothing identifying a source, dataset,
hypothesis, or statistic ever leaves the private trust domain**. On-chain accounts hold
32-byte hashes; the signer receives a bounded intent; external AI receives an allowlisted
abstraction only.

## Commands

```bash
npm run dev              # concurrently: API (:8787, --watch) + Vite (:5173, proxies /api)
npm run build            # tsc -b && vite build
npm run lint             # oxlint (config in .oxlintrc.json)
npm test                 # node --test server/test/*.test.mjs  (PG tests self-skip)
npm run test:integration # spins up disposable postgres-test container, runs all tests with TEST_DATABASE_URL
npm run test:contracts   # contracts + runtime-config only
npm run db:migrate       # apply server/db/migrations/*.sql
npm run seed             # idempotent PUBLIC_CATALOG seed (server must be stopped)
npm run auth:hash -- 'password'   # prints OWNER_PASSWORD_HASH= line for .env
npm run signer:address   # Devnet publisher address, without exposing the key
npm run check:anchor     # cargo check -p qarau-registry
npm run test:anchor      # cargo test -p qarau-registry --lib
```

Run a single Node test file: `node --test server/test/queue.test.mjs`
Run a single test by name: `node --test --test-name-pattern 'idempotent' server/test/queue.test.mjs`

Anything touching PostgreSQL calls `testDatabaseUrl()` from
[server/test/database-url.mjs](server/test/database-url.mjs) and marks itself
`{ skip: !enabled }`. That helper **refuses** any `TEST_DATABASE_URL` whose database name
does not contain `test`. New DB-backed tests must follow the same pattern — never point
tests at the durable `qarau` database.

`docker compose up --build` runs the full integrated topology (postgres, MinIO, API,
four workers, scheduler, publisher signer). `--profile tools` exposes the `migrate`
one-shot; `--profile test` exposes `postgres-test` on `127.0.0.1:55432`.

## Two runtimes in one repo

`QARAU_RUNTIME_MODE` selects which persistence layer is live, and this is the single most
important thing to know before editing server code:

- **`legacy`** (default, `npm run dev`) — [server/qarau-service.mjs](server/qarau-service.mjs)
  over one AES-256-GCM encrypted file under `server/data/private/`. Serves the legacy owner
  UI routes mounted directly in [server/index.mjs](server/index.mjs) (`/api/qarau/*`,
  `/api/research/*`).
- **`integrated`** (compose, production) — PostgreSQL + S3-compatible private object store.
  Mounts [server/api/v1.mjs](server/api/v1.mjs) at `/api/v1`. This is the durable path;
  new work belongs here.

`/api/v1` is **not mounted at all** in legacy mode. A change that only shows up under
`/api/v1` will not be visible from a plain `npm run dev` unless `QARAU_RUNTIME_MODE=integrated`
and the database/S3 env is present.

## Process topology

Every process is one entry point with a role-scoped environment contract in
[server/runtime/config.mjs](server/runtime/config.mjs). `loadServiceConfig(role)` validates
exactly the variables that role is allowed to have, and **throws if any non-signer role
sees `SOLANA_PUBLISHER_KEY_PATH`** — the key boundary is enforced at startup, not by
convention.

| Role | Command | Health port | DB role |
|---|---|---|---|
| `api` | `start:api` | 8787 | `qarau_api` |
| `worker-discovery` | `start:worker:discovery` | 8791 | `qarau_worker` |
| `worker-scrape` | `start:worker:scrape` | 8792 | `qarau_worker` |
| `worker-analysis` | `start:worker:analysis` | 8793 | `qarau_worker` |
| `worker-chain` | `start:worker:chain` | 8794 | `qarau_chain` |
| `scheduler` | `start:scheduler` | 8795 | `qarau_worker` |
| `publisher-signer` | `start:publisher-signer` | 8796 | none |

Workers only claim jobs when `QARAU_WORKER_EXECUTE=true`; otherwise they report
`foundation-only` on `/health/ready` and idle. All of them share
[server/runtime/worker-entry.mjs](server/runtime/worker-entry.mjs), which wires the role to
its handler set.

The API deliberately reads `API_PORT`, never `PORT` — dev tooling sets `PORT` and the API
would otherwise collide with Vite.

PostgreSQL roles are least-privilege ([infra/postgres/init/001-roles.sql](infra/postgres/init/001-roles.sql)):
`qarau_chain` has no `DELETE`. Migrations run as `qarau_owner`.

## Job queue

[server/jobs/queue.mjs](server/jobs/queue.mjs) is a PostgreSQL-backed queue with
database-enforced idempotency (`ON CONFLICT (idempotency_key) DO NOTHING`) and leases — a
worker may only settle a job while it holds the current unexpired lease.

Job payloads are a closed contract in [server/jobs/payloads.mjs](server/jobs/payloads.mjs):
each type declares its owning role, a payload `version`, and a `.strict()` Zod schema.
`jobIdempotencyKey()` hashes canonical JSON of the parsed payload. **Adding or changing a
job type means editing `JOB_PAYLOADS`, bumping `version` if the shape changed, and adding
the handler to the right role in `worker-entry.mjs`** — the payload is re-validated on
both enqueue and claim, so a mismatch fails loudly.

Types: `discovery.run`, `scrape.source`, `analysis.run`, `chain.publish`,
`chain.reconcile`, `schedule.due-sources`.

## Hashing and the on-chain contract

[server/domain/canonical-artifacts.mjs](server/domain/canonical-artifacts.mjs) is the
single source of truth for:

- `HASH_DOMAINS` — domain-separated prefixes (`QARAU_RAW_SNAPSHOT_V1\0` etc.). Every hash
  is `sha256(domain || canonicalJson(value))`. Never hash without a domain.
- `SOLANA_ACCOUNT_LAYOUTS` — field sizes and exact `space` for `Registry`,
  `DatasetCommitment`, `AccessRound`, `Bid`, and `AccessEntitlement` (legacy Sale/AccessGrant
  layouts remain for decoding historical accounts).

These layouts mirror [programs/qarau_registry/src/lib.rs](programs/qarau_registry/src/lib.rs).
**Changing an Anchor account struct requires updating the JS layout in the same change**;
[server/test/contracts.test.mjs](server/test/contracts.test.mjs) and
[contracts/](contracts/) fixtures pin the pair. `contracts/api-v1.json` pins the HTTP
contract the same way.

Program ID `63VZwKUPcWqo2JwpQHLxT4HHgQsMREpERZg3DpfSnnMw`, Devnet only —
`SOLANA_RPC_URL` validation in `runtime/config.mjs` rejects anything that isn't devnet or
localhost.

## Pipeline

```
discovery.run  → sources (canonical URL encrypted at rest, hashed for dedup)
scrape.source  → source_snapshots (raw bytes to object store + rawSnapshotHash)
                 → normalization/canonical-jsonl.mjs → dataset_versions (normalizedDatasetHash)
analysis.run   → analysis_runs, signal_candidates, validation_results, leakage_checks
                 (manifestHash + resultHash, alpha_score)
POST /api/v1/analysis-runs/:id/packages → dataset_packages (status: sealed, accessPolicyHash)
POST /api/v1/packages/:id/publish       → chain.publish job → commit_pending
chain.publish  → publisher-signer → DatasetCommitment + AccessRound PDAs → status: committed
chain.settle   → publisher-signer → settled Top-N ranking and clearing price
```

A package can only be sealed from a `completed` analysis run with no `blocking_leakage`.
Publish failures set `publication_failed` and the package can be re-published (the handler
wrapper in `worker-entry.mjs` does this rollback).

## Auth: two independent identities

- **Owner** — password (`scrypt`) → server-side session, HttpOnly SameSite=strict cookie,
  per-session CSRF token (`X-CSRF-Token`). [server/auth.mjs](server/auth.mjs).
  `requireOwner` + `requireCsrf` are applied to whole routers, never per-route, so a new
  endpoint cannot be added unprotected by forgetting middleware.
- **Wallet** — Sign-In With Solana, [server/wallet/siws.mjs](server/wallet/siws.mjs).
   Wallet users only. Used for bid, claim, refund, and entitlement routes.

In `v1.mjs`, `isOwnerPath()` is a regex allowlist deciding which paths enter the owner
router; `/api/v1/opportunities` and `/opportunities/:id|proof` are public and must stay
outside it. `publicPackage()` filters through `NON_SENSITIVE_PUBLIC_FIELDS` — do not widen
that set casually.

## Egress boundary

All outbound source fetching goes through [server/ingestion/fetch.mjs](server/ingestion/fetch.mjs)
and [server/lib/url-policy.mjs](server/lib/url-policy.mjs) / [server/security/source-url.mjs](server/security/source-url.mjs):
HTTP(S) only, every DNS result validated, connection pinned to the checked IP, no
redirects, size-capped, textual media types only. **Never add a bare `fetch()` for
user- or source-supplied URLs.**

Canonical source URLs are stored as ciphertext (`SOURCE_URL_ENCRYPTION_KEY`, 64 hex chars)
plus a hash for deduplication.

## Frontend

Vite + React 19 + react-router. `src/pages/Opportunities.tsx` and `MyAccess.tsx` are the public
routes — [src/App.tsx](src/App.tsx) short-circuits them *before* any session check, so they
must never read owner state. Everything else renders `Authenticate` until the session
resolves; that gate is convenience only, the API rejects regardless.

[src/api/client.ts](src/api/client.ts) is the only place that talks HTTP: it holds the CSRF
token, uses `credentials: "include"`, and notifies `onUnauthorized` listeners on 401.
`VITE_API_BASE` is empty in dev (Vite proxies `/api` to `API_PORT`).

## Conventions

- Server is `.mjs` ESM, no build step, no `server/package.json` — the root
  `package-lock.json` is authoritative for every process, including the Docker image.
- Node 24 / npm 11 are pinned in `engines`; the Dockerfile builds from the repo root.
- Zod is the validation layer everywhere on the server (env, job payloads, request bodies).
- Comments in this codebase explain *why* a non-obvious choice was made (see the `API_PORT`
  and `ScrollToTop` comments). Match that — don't add narration comments.
- Existing tests and the `contracts/` fixtures are the regression surface; changing a hash
  domain, account layout, job payload, or API shape should break them on purpose.

## Reference docs

[README.md](README.md) (product + local setup), [SECURITY.md](SECURITY.md) (enforced
boundaries), [docs/runtime/services.md](docs/runtime/services.md),
[docs/runtime/credential-matrix.md](docs/runtime/credential-matrix.md),
[docs/adr/](docs/adr/) (0001 persistence, 0002 artifact hashing, 0003 Solana accounts,
0004 wallet auth, 0005 access policy, 0006 quantitative contract),
[QARAU_MVP_INTEGRATION_PLAN.md](QARAU_MVP_INTEGRATION_PLAN.md) (delivery sequence).

# Runtime services

Node.js 24 and the root `package-lock.json` are authoritative for every JavaScript process. The API-only Dockerfile is built from the repository root; `server/package.json` is intentionally absent.

| Service | Entry command | Readiness | Network exposure |
|---|---|---|---|
| API | `npm run start:api` | `/api/health` | Public port 8787 |
| Discovery worker | `npm run start:worker:discovery` | private port 8791 | Private only |
| Scrape worker | `npm run start:worker:scrape` | private port 8792 | Private only |
| Analysis worker | `npm run start:worker:analysis` | private port 8793 | Private only |
| Chain worker | `npm run start:worker:chain` | private port 8794 | Private only |
| Scheduler | `npm run start:scheduler` | private port 8795 | Private only |
| Publisher signer | `npm run start:publisher-signer` | private port 8796 | Private only |

Worker entry points validate their role-scoped environment and expose process readiness. With `QARAU_WORKER_EXECUTE=true` they claim and execute their bounded durable jobs and report `worker-execution-active`; without it they report `foundation-only`. Readiness means the process and its configured execution mode are healthy.

Development defaults in `compose.yaml` are local-only. A deployed environment must inject independent credentials from its secret manager, deny public routes to PostgreSQL/object storage/signer, and mount only the operational publisher key into the signer service. The deployment/upgrade authority must never be mounted into an application container.

The automated Data.gov discovery worker uses the official v4 catalog API. `DEMO_KEY` is suitable only for brief local exploration; set `DATA_GOV_API_KEY` to a personal key for unattended operation. Upstream rate limits are retained as retryable job errors with their wait period instead of being silently replaced with seed data.

## Emergency stop (registry kill-switch)

`registry.paused` gates `create_dataset_commitment`, `create_sale`, `create_access_round`, `purchase`, `place_bid`, `claim_entitlement` and `refund_losing_bid`. Pausing therefore stops new commitments, new rounds, and all bidder activity. `settle_access_round` is deliberately not gated, so a round that has already closed can still be settled while the registry is paused; already-claimed entitlements stay readable.

The owner pulls it through the product, not through the upgrade authority:

```
POST /api/v1/registry/pause   { "paused": true }    # owner session + X-CSRF-Token
```

The API holds no signer credentials, so the request is queued as a `chain.pause` job. The chain worker claims it within its one-second poll and calls the isolated publisher signer, which holds the registry authority key set at `initialize`. Unpausing is the same endpoint with `{ "paused": false }` — there is no separate control, so an unpause is always an explicit, audited act.

Every attempt writes an `audit_events` row (`registry.pause` / `registry.unpause`) with outcome `applied` or `failed`, including a refused switch. `audit_events` is insert-only for every runtime role.

If the queue or the chain worker is itself unavailable, the switch is unreachable by this path and recovery requires the upgrade authority out of band — which must never be mounted into an application container.

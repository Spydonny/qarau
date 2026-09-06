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

# QARAU Security Posture

QARAU is owner-only research infrastructure. Security controls aim to keep source
content, research state, and operational signing authority in separate trust domains.

## Enforced boundaries

- Authentication uses salted `scrypt`, constant-time verification, server-side sessions,
  an HttpOnly strict cookie, login throttling, and a per-session CSRF token.
- All research routes inherit owner authentication from their parent routers.
- The external fetcher accepts HTTP(S) only, rejects localhost and non-public addresses,
  validates every DNS result, pins the connection to a checked IP, rejects redirects,
  caps response size, and accepts textual media types only.
- CSV and JSON ingestion enforce byte, row, column, field, timestamp, duplicate, and
  numeric-value limits. User filenames are never used as filesystem paths.
- Persisted state is AES-256-GCM encrypted. Production must inject
  `DATA_ENCRYPTION_KEY` from secret storage independent of the data volume.
- The local analyzer emits a fixed data shape and has no shell, database, network,
  browser, or signer capability. Optional OpenAI-compatible analysis receives only an
  allowlisted `AI_SAFE` abstraction for `PUBLIC_SOURCE` records; unknown output fields
  and sensitive-source requests are rejected.
- Alpha Lab uses immutable snapshot IDs, chronological folds, train-only preprocessing,
  and feature `available_at` checks at every prediction boundary.
- Commitments use canonical JSON, separate source/analysis domains, random 32-byte salts,
  private Merkle proofs, and a fixed-cadence batched root. No source URL, hypothesis,
  dataset, provider identity, target, or statistic is placed in the signer intent.

## Signer boundary

The API spawns `server/signer/devnet-signer.mjs` as a child process and sends one bounded
JSON intent through stdin. The signer enforces:

- Exact `{ action, epoch, root, version }` shape.
- `COMMIT_MERKLE_ROOT` as the only action and schema version `1`.
- A hard-coded Solana Devnet endpoint and Memo program allowlist.
- A signer key stored only under ignored `server/data/private/`.
- Root/epoch idempotency, 24 transactions per UTC day, preflight, and confirmation polling.

Application state changes to `COMMITTED_ONCHAIN` only after a real confirmed or finalized
signature is returned. The included Anchor registry program enforces authority and PDA
constraints and prevents duplicate epoch initialization, but it has not been deployed;
the current operational transport is the standard Memo program.

## Kill switches

`DISABLE_EXTERNAL_AI`, `DISABLE_CRAWLING`, `DISABLE_SOLANA_SIGNING`, and
`DISABLE_DATA_EXPORT` are fail-closed controls. There is no data-export endpoint in this
MVP. `DEV_AUTO_AIRDROP` is development-only and never enables Mainnet transactions.

## Scenario review

| Scenario | Current result |
| --- | --- |
| 1. Crawler fully compromised | Crawler code receives no signer key or AI credential. DNS pinning blocks private infrastructure, but it is in-process in this local MVP, so a process-level compromise could reach encrypted application memory; separate service/container isolation is required before production. |
| 2. External AI records every request | Local mode sends nothing. Optional external mode receives broad category/region and bounded sanitized text only; private endpoint, exact geography, datasets, IDs, targets, and Alpha results are excluded. |
| 3. Persistence volume stolen | The state payload is AES-256-GCM ciphertext and the configured master key can be supplied independently. Local auto-generated key storage is a development convenience and must be replaced with managed keys in production. |
| 4. Alpha worker compromised | It receives immutable in-memory snapshots and has no signer interface, but it is not yet a separately sandboxed worker. Production requires scoped object access, no egress, and CPU/memory/time limits. |
| 5. Blockchain observer | The observer sees periodic epoch/version/Merkle-root metadata and operational wallet activity, not individual leaves or source-to-analysis timing. Native public-chain payments would not be private and are not implemented. |
| 6. Source contains prompt injection | Active HTML is removed; content remains tainted data; the analyzer has no tools; strict schema validation prevents output from becoming URLs, code, SQL, shell, or signer instructions. |
| 7. Operational signer compromised | Damage is bounded to its small Devnet wallet, allowlisted Memo instruction, daily transaction cap, and root-only intent. No treasury exists in the MVP and Anchor upgrade authority is separate from the operational key path. |

## Production gaps

Before production, deploy the crawler, AI gateway, and Alpha worker as separate restricted
services; move persistence from the encrypted single-node store to PostgreSQL/object
storage with row/object envelope encryption, migrations, scoped roles, and managed keys;
use a network-isolated JSON job queue; add centralized append-only audit retention and
secret rotation; deploy and independently audit the Anchor registry; move operational
signing and upgrade authority to managed/multisig controls; and exercise restore/disaster
recovery. The current local deployment should not custody production alpha or funds.

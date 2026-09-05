# Credential and network matrix

| Service | Database | Object store | Solana RPC | Signer token | Publisher key | Owner/session secrets |
|---|---|---|---|---|---|---|
| API | API role, app/session/package reads and writes | Read only, authorized streaming | Read | No | No | Yes |
| Discovery worker | Worker role | No | No | No | No | No |
| Scrape worker | Worker role | Raw read/write | No | No | No | No |
| Analysis worker | Worker role | Dataset/analysis/package read/write | No | No | No | No |
| Chain worker | Chain role | Hash/manifest read only | Read/write RPC | Yes | No | No |
| Scheduler | Queue enqueue role | No | No | No | No | No |
| Publisher signer | No | No | Devnet write only | Server-side verifier | Operational key only | No |

Rules:

1. A service receives only the variables listed for its role; `.env` is used by Compose for interpolation and is not mounted wholesale.
2. `SOLANA_PUBLISHER_KEY_PATH` is rejected for every role except `publisher-signer`.
3. The signer accepts only authenticated, typed, allowlisted intents and independently decodes accounts and instruction data before signing.
4. Mainnet RPC URLs are rejected in MVP. Devnet and local validator are the only supported clusters.
5. Storage credentials are server-side only. Browser builds may never contain `DATABASE_URL`, S3 credentials, session secrets, signer tokens, or RPC write credentials.
6. Local Compose credentials are visibly named local-only and must never be reused outside a developer machine.

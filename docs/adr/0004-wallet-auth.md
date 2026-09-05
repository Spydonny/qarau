# ADR 0004: Wallet authentication and purchase confirmation

- Status: Accepted
- Date: 2026-09-05
- Decisions: D-04, D-15

## Context

A wallet address supplied in a request is not authentication, and a transaction signature alone does not prove which instruction, price, treasury, or grant was executed.

## Decision

- Wallet discovery and signing use Wallet Standard. Authentication uses Sign In With Solana (SIWS); a legacy message-signing wallet may sign only the exact SIWS-compatible message issued by the server.
- A challenge binds domain, URI, address when known, chain ID, nonce, statement, issued time, and expiry. Nonces are random, stored as hashes, single-use, short-lived, and consumed in the same PostgreSQL transaction that creates the session.
- Verification checks exact message bytes, Ed25519 signature, nonce, address, domain, URI, chain, issued/expiry time, and replay status.
- Wallet and owner sessions use different cookie names and middleware. Both cookies are random opaque tokens stored only as hashes server-side, `HttpOnly`, `Secure` in production, and `SameSite=Strict`.
- A purchase transaction is bound to the authenticated session wallet, configured program, canonical accounts, tier, and recent blockhash. The buyer signs and submits it from the wallet.
- Confirmation fetches and decodes the transaction and resulting accounts. `confirmed` is UI-only pending state; finalized transaction and grant/sale accounts are required for access.

## Consequences

The backend never receives buyer private keys and never trusts client-supplied identity, amount, treasury, or grant data. RPC uncertainty produces a retryable unavailable response, not access.

## Verification

Tests cover replay, altered message bytes, wrong domain/URI/chain/address, expired challenge, session fixation, wrong network, failed transaction, account substitution, and confirmed-but-not-finalized denial.

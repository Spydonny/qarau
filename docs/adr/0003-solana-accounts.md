# ADR 0003: Solana marketplace accounts and authority

- Status: Accepted
- Date: 2026-09-05
- Decisions: D-01, D-02, D-03, D-10, D-12, D-13

## Context

The current epoch/Memo path proves only that a root existed. It cannot own sale windows, seat counts, buyer payments, tiers, or grants.

## Decision

- V1 uses the custom Anchor program on local validator and Devnet. Native SOL is the only payment asset. Sales are fixed-price and time-bounded.
- PDAs are `registry`, `dataset + dataset_id_hash + version_le_u32`, `sale + DatasetCommitment`, and `grant + DatasetCommitment + buyer`.
- Frozen account fields and allocated byte counts, including the eight-byte Anchor discriminator, are defined in `server/domain/canonical-artifacts.mjs`: Registry 76, DatasetCommitment 271, Sale 156, AccessGrant 159.
- `purchase_access` reads price from Sale, transfers exact lamports through the System Program, initializes the canonical grant, and increments seats atomically. No amount is accepted from client instruction data.
- One immutable Sale exists per DatasetCommitment. Suspending or ending a sale does not revoke grants. Revocation does not free a seat or imply a refund.
- Dataset version monotonicity is enforced and audited off-chain; the PDA prevents duplicate versions. V1 does not claim to prove absence of skipped version numbers.
- Registry authority and treasury rotation are unsupported in V1. Devnet remains upgradeable; the upgrade key is separated from the operational publisher key.
- Epoch/Memo commitments may remain as a secondary private audit stream but are never presented as marketplace provenance.

## Consequences

The on-chain program becomes the only authority for commitments, sale state, occupied seats, and grants. Program layout or seed changes require a new program/schema version.

## Verification

Rust and TypeScript must agree on seeds, hashes, and account spaces. Local-validator tests cover unauthorized publication, account substitution, sale timing, wrong treasury, duplicate grant, the final-seat race, arithmetic overflow, and transaction atomicity.

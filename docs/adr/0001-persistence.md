# ADR 0001: Durable persistence, artifacts, and jobs

- Status: Accepted
- Date: 2026-09-05
- Decisions: D-05, D-06, D-07, D-15

## Context

The prototype keeps mutable workflow state and derived data in one encrypted local file and runs long work in-process. That cannot provide concurrent seat-safe workflows, immutable raw artifacts, crash recovery, or multi-process deployment.

## Decision

- PostgreSQL is authoritative for workflow metadata, sessions, jobs, audits, package records, and non-authoritative Solana reconciliation caches.
- A private S3-compatible store is authoritative for immutable raw, normalized, analysis, package, and export bytes. Local development uses MinIO.
- The queue is PostgreSQL-backed and at-least-once. Workers claim rows with leases and `FOR UPDATE SKIP LOCKED`; every handler is idempotent.
- Object creation uses deterministic keys, conditional put, `HEAD` verification, and a database sealing transition. PostgreSQL and S3 are never described as one transaction.
- Solana remains authoritative for commitment, sale, seats, and access grants. A confirmed transaction may be shown as pending; only finalized state authorizes private bytes.
- Legacy `EncryptedStore` remains behind an adapter until the offline import and equivalence gates pass.

## Consequences

The system gains durable recovery and independently scalable workers. It also gains two external services and must reconcile cross-system side effects explicitly. Storage URLs and internal object keys are never returned to buyers.

## Verification

- Crash-recovery tests reclaim expired queue leases without duplicating domain rows.
- Put-once tests reject changed bytes at an existing object key.
- Sealing tests cannot reach `SEALED` before object metadata/hash verification.
- Authorization tests fail closed when finalized Solana state is unavailable.

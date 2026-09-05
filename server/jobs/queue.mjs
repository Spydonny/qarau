import { inTransaction } from "../db/pool.mjs";
import { parseJobPayload } from "./payloads.mjs";
import { retryDelaySeconds, retryableError } from "./retry-policy.mjs";

function positiveInteger(value, label, fallback) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) throw new Error(`invalid_${label}`);
  return resolved;
}

function nonEmptyString(value, label, maxLength = 256) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) throw new Error(`invalid_${label}`);
  return value;
}

/**
 * PostgreSQL-backed job queue with database-enforced idempotency and leases.
 * A worker may only settle the job while it owns the current, unexpired lease.
 */
export class PostgresJobQueue {
  constructor(pool, { defaultMaxAttempts = 5, leaseSeconds = 60 } = {}) {
    this.pool = pool;
    this.defaultMaxAttempts = positiveInteger(defaultMaxAttempts, "max_attempts");
    this.leaseSeconds = positiveInteger(leaseSeconds, "lease_seconds");
  }

  async enqueue({ type, payload, payloadVersion = 1, idempotencyKey, resourceType = null, resourceId = null, maxAttempts = this.defaultMaxAttempts }) {
    nonEmptyString(type, "job_type", 128);
    nonEmptyString(idempotencyKey, "idempotency_key", 256);
    positiveInteger(payloadVersion, "payload_version");
    positiveInteger(maxAttempts, "max_attempts");
    if (payload === undefined) throw new Error("job_payload_required");
    const validatedPayload = parseJobPayload(type, payloadVersion, payload);

    return inTransaction(this.pool, async (client) => {
      const created = await client.query(
        `INSERT INTO jobs (type, payload_version, payload, idempotency_key, resource_type, resource_id, max_attempts)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [type, payloadVersion, validatedPayload, idempotencyKey, resourceType, resourceId, maxAttempts],
      );
      if (created.rowCount) return { job: created.rows[0], created: true };

      const existing = await client.query("SELECT * FROM jobs WHERE idempotency_key = $1", [idempotencyKey]);
      return { job: existing.rows[0], created: false };
    });
  }

  async claim({ workerId, types = null, leaseSeconds = this.leaseSeconds }) {
    nonEmptyString(workerId, "worker_id", 128);
    const duration = positiveInteger(leaseSeconds, "lease_seconds");
    if (types !== null && (!Array.isArray(types) || types.some((type) => typeof type !== "string" || !type))) {
      throw new Error("invalid_job_types");
    }

    return inTransaction(this.pool, async (client) => {
      const result = await client.query(
        `WITH candidate AS (
           SELECT id
           FROM jobs
           WHERE attempts < max_attempts
             AND (
               (status IN ('queued', 'retry_wait') AND available_at <= now())
               OR (status = 'running' AND lease_until <= now())
             )
             AND ($1::text[] IS NULL OR type = ANY($1))
           ORDER BY available_at, created_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE jobs AS job
         SET status = 'running',
             attempts = attempts + 1,
             lease_owner = $2,
             lease_until = now() + make_interval(secs => $3::integer),
             heartbeat_at = now(),
             started_at = COALESCE(started_at, now()),
             updated_at = now(),
             error_code = NULL,
             error_detail = NULL
         FROM candidate
         WHERE job.id = candidate.id
         RETURNING job.*`,
        [types, workerId, duration],
      );
      return result.rows[0] ?? null;
    });
  }

  async heartbeat(jobId, workerId, leaseSeconds = this.leaseSeconds) {
    nonEmptyString(jobId, "job_id", 64);
    nonEmptyString(workerId, "worker_id", 128);
    const duration = positiveInteger(leaseSeconds, "lease_seconds");
    const result = await this.pool.query(
      `UPDATE jobs
       SET lease_until = now() + make_interval(secs => $3::integer), heartbeat_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'running' AND lease_owner = $2 AND lease_until > now()
       RETURNING *`,
      [jobId, workerId, duration],
    );
    if (!result.rowCount) throw new Error("job_lease_not_owned");
    return result.rows[0];
  }

  async complete(jobId, workerId, result = {}) {
    nonEmptyString(jobId, "job_id", 64);
    nonEmptyString(workerId, "worker_id", 128);
    const settled = await this.pool.query(
      `UPDATE jobs
       SET status = 'completed', result = $3, completed_at = now(), updated_at = now(),
           lease_owner = NULL, lease_until = NULL, heartbeat_at = NULL
       WHERE id = $1 AND status = 'running' AND lease_owner = $2 AND lease_until > now()
       RETURNING *`,
      [jobId, workerId, result],
    );
    if (!settled.rowCount) throw new Error("job_lease_not_owned");
    return settled.rows[0];
  }

  async fail(jobId, workerId, { errorCode, errorDetail = null, retryDelaySeconds: explicitRetryDelaySeconds = null } = {}) {
    nonEmptyString(jobId, "job_id", 64);
    nonEmptyString(workerId, "worker_id", 128);
    nonEmptyString(errorCode, "error_code", 128);
    if (explicitRetryDelaySeconds !== null && (!Number.isInteger(explicitRetryDelaySeconds) || explicitRetryDelaySeconds < 0)) throw new Error("invalid_retry_delay_seconds");

    return inTransaction(this.pool, async (client) => {
      const current = await client.query(
        "SELECT * FROM jobs WHERE id = $1 FOR UPDATE",
        [jobId],
      );
      const job = current.rows[0];
      if (!job || job.status !== "running" || job.lease_owner !== workerId || new Date(job.lease_until) <= new Date()) {
        throw new Error("job_lease_not_owned");
      }
      const terminal = job.attempts >= job.max_attempts || !retryableError(errorCode);
      const retryDelaySeconds = explicitRetryDelaySeconds ?? retryDelaySecondsFor(job.attempts);
      const updated = await client.query(
        `UPDATE jobs
         SET status = $2::job_status,
             available_at = CASE WHEN $2 = 'retry_wait' THEN now() + make_interval(secs => $3::integer) ELSE available_at END,
             error_code = $4,
             error_detail = $5,
             lease_owner = NULL,
             lease_until = NULL,
             heartbeat_at = NULL,
             completed_at = CASE WHEN $2 = 'dead_letter' THEN now() ELSE completed_at END,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [jobId, terminal ? "dead_letter" : "retry_wait", retryDelaySeconds, errorCode, errorDetail],
      );
      return updated.rows[0];
    });
  }

  async recoverExpired() {
    const result = await this.pool.query(
      `UPDATE jobs
       SET status = CASE WHEN attempts >= max_attempts THEN 'dead_letter'::job_status ELSE 'retry_wait'::job_status END,
           lease_owner = NULL,
           lease_until = NULL,
           heartbeat_at = NULL,
           completed_at = CASE WHEN attempts >= max_attempts THEN now() ELSE completed_at END,
           error_code = COALESCE(error_code, 'lease_expired'),
           error_detail = COALESCE(error_detail, 'Worker lease expired before the job settled'),
           updated_at = now()
       WHERE status = 'running' AND lease_until <= now()
       RETURNING *`,
    );
    return result.rows;
  }
}

function retryDelaySecondsFor(attempt) {
  return retryDelaySeconds(attempt);
}

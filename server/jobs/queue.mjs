import { fromDoc, isDuplicateKey, newId } from "../db/mongo.mjs";
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

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1_000);
}

/**
 * MongoDB-backed job queue with collection-enforced idempotency and leases.
 * A worker may only settle the job while it owns the current, unexpired lease.
 * Claim/heartbeat/settle use atomic findOneAndUpdate compare-and-set, which
 * replaces FOR UPDATE SKIP LOCKED.
 */
export class MongoJobQueue {
  constructor(db, { defaultMaxAttempts = 5, leaseSeconds = 60 } = {}) {
    this.db = db;
    this.col = db?.collection?.("jobs") ?? null;
    this.defaultMaxAttempts = positiveInteger(defaultMaxAttempts, "max_attempts");
    this.leaseSeconds = positiveInteger(leaseSeconds, "lease_seconds");
  }

  get pool() {
    return this.db;
  }

  async enqueue({ type, payload, payloadVersion = 1, idempotencyKey, resourceType = null, resourceId = null, maxAttempts = this.defaultMaxAttempts }) {
    nonEmptyString(type, "job_type", 128);
    nonEmptyString(idempotencyKey, "idempotency_key", 256);
    positiveInteger(payloadVersion, "payload_version");
    positiveInteger(maxAttempts, "max_attempts");
    if (payload === undefined) throw new Error("job_payload_required");
    const validatedPayload = parseJobPayload(type, payloadVersion, payload);

    const now = new Date();
    const doc = {
      _id: newId(),
      type,
      payload_version: payloadVersion,
      payload: validatedPayload,
      status: "queued",
      attempts: 0,
      max_attempts: maxAttempts,
      idempotency_key: idempotencyKey,
      resource_type: resourceType,
      resource_id: resourceId,
      progress: {},
      available_at: now,
      lease_owner: null,
      lease_until: null,
      heartbeat_at: null,
      result: null,
      error_code: null,
      error_detail: null,
      created_at: now,
      started_at: null,
      completed_at: null,
      updated_at: now,
    };
    try {
      await this.col.insertOne(doc);
      return { job: fromDoc(doc), created: true };
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const existing = await this.col.findOne({ idempotency_key: idempotencyKey });
      return { job: fromDoc(existing), created: false };
    }
  }

  claimFilter(types, now) {
    const typeClause = types === null ? [] : [{ type: { $in: types } }];
    return {
      $and: [
        ...typeClause,
        {
          $or: [
            { status: { $in: ["queued", "retry_wait"] }, available_at: { $lte: now }, $expr: { $lt: ["$attempts", "$max_attempts"] } },
            { status: "running", lease_until: { $lte: now } },
          ],
        },
      ],
    };
  }

  async claim({ workerId, types = null, leaseSeconds = this.leaseSeconds }) {
    nonEmptyString(workerId, "worker_id", 128);
    const duration = positiveInteger(leaseSeconds, "lease_seconds");
    if (types !== null && (!Array.isArray(types) || types.some((type) => typeof type !== "string" || !type))) {
      throw new Error("invalid_job_types");
    }

    const now = new Date();
    const result = await this.col.findOneAndUpdate(
      this.claimFilter(types, now),
      {
        $inc: { attempts: 1 },
        $set: {
          status: "running",
          lease_owner: workerId,
          lease_until: addSeconds(now, duration),
          heartbeat_at: now,
          updated_at: now,
          error_code: null,
          error_detail: null,
        },
        $setOnInsert: {},
      },
      { sort: { available_at: 1, created_at: 1, _id: 1 }, returnDocument: "after" },
    );
    if (!result) return null;
    if (!result.started_at) {
      const started = await this.col.findOneAndUpdate(
        { _id: result._id, started_at: null },
        { $set: { started_at: now } },
        { returnDocument: "after" },
      );
      return fromDoc(started ?? result);
    }
    return fromDoc(result);
  }

  leaseFilter(jobId, workerId, now) {
    return { _id: jobId, status: "running", lease_owner: workerId, lease_until: { $gt: now } };
  }

  async heartbeat(jobId, workerId, leaseSeconds = this.leaseSeconds) {
    nonEmptyString(jobId, "job_id", 64);
    nonEmptyString(workerId, "worker_id", 128);
    const duration = positiveInteger(leaseSeconds, "lease_seconds");
    const now = new Date();
    const result = await this.col.findOneAndUpdate(
      this.leaseFilter(jobId, workerId, now),
      { $set: { lease_until: addSeconds(now, duration), heartbeat_at: now, updated_at: now } },
      { returnDocument: "after" },
    );
    if (!result) throw new Error("job_lease_not_owned");
    return fromDoc(result);
  }

  async complete(jobId, workerId, result = {}) {
    nonEmptyString(jobId, "job_id", 64);
    nonEmptyString(workerId, "worker_id", 128);
    const now = new Date();
    const settled = await this.col.findOneAndUpdate(
      this.leaseFilter(jobId, workerId, now),
      {
        $set: {
          status: "completed",
          result,
          completed_at: now,
          updated_at: now,
          lease_owner: null,
          lease_until: null,
          heartbeat_at: null,
        },
      },
      { returnDocument: "after" },
    );
    if (!settled) throw new Error("job_lease_not_owned");
    return fromDoc(settled);
  }

  async fail(jobId, workerId, { errorCode, errorDetail = null, retryDelaySeconds: explicitRetryDelaySeconds = null } = {}) {
    nonEmptyString(jobId, "job_id", 64);
    nonEmptyString(workerId, "worker_id", 128);
    nonEmptyString(errorCode, "error_code", 128);
    if (explicitRetryDelaySeconds !== null && (!Number.isInteger(explicitRetryDelaySeconds) || explicitRetryDelaySeconds < 0)) throw new Error("invalid_retry_delay_seconds");

    const now = new Date();
    const job = await this.col.findOne({ _id: jobId });
    if (!job || job.status !== "running" || job.lease_owner !== workerId || !(job.lease_until instanceof Date && job.lease_until > now)) {
      throw new Error("job_lease_not_owned");
    }
    const terminal = job.attempts >= job.max_attempts || !retryableError(errorCode);
    const delay = explicitRetryDelaySeconds ?? retryDelaySeconds(job.attempts);
    const settled = await this.col.findOneAndUpdate(
      this.leaseFilter(jobId, workerId, new Date()),
      {
        $set: {
          status: terminal ? "dead_letter" : "retry_wait",
          error_code: errorCode,
          error_detail: errorDetail,
          lease_owner: null,
          lease_until: null,
          heartbeat_at: null,
          updated_at: new Date(),
          ...(terminal ? { completed_at: new Date() } : { available_at: addSeconds(new Date(), delay) }),
        },
      },
      { returnDocument: "after" },
    );
    if (!settled) throw new Error("job_lease_not_owned");
    return fromDoc(settled);
  }

  async recoverExpired() {
    const now = new Date();
    const expired = await this.col.find({ status: "running", lease_until: { $lte: now } }).toArray();
    for (const job of expired) {
      const terminal = job.attempts >= job.max_attempts;
      await this.col.updateOne(
        { _id: job._id, status: "running", lease_until: { $lte: new Date() } },
        {
          $set: {
            status: terminal ? "dead_letter" : "retry_wait",
            lease_owner: null,
            lease_until: null,
            heartbeat_at: null,
            error_code: job.error_code ?? "lease_expired",
            error_detail: job.error_detail ?? "Worker lease expired before the job settled",
            updated_at: new Date(),
            ...(terminal ? { completed_at: new Date() } : {}),
          },
        },
      );
    }
    return expired.map(fromDoc);
  }
}

export { MongoJobQueue as PostgresJobQueue };

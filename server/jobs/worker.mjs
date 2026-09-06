import { parseJobPayload } from "./payloads.mjs";

function errorCode(error) {
  const message = String(error?.message ?? "job_failed");
  return /^[a-z0-9_:-]{1,128}$/i.test(message) ? message : "job_failed";
}

/** A single-concurrency at-least-once worker; handlers must remain idempotent. */
export function createQueueWorker({ queue, workerId, types, handlers, pollMs = 1_000 }) {
  if (!queue || typeof queue.claim !== "function" || !workerId || !Array.isArray(types)) throw new Error("invalid_queue_worker_configuration");
  let stopped = false;
  let timer = null;

  async function runOnce() {
    const job = await queue.claim({ workerId, types });
    if (!job) return false;
    const leaseSeconds = Number.isInteger(queue.leaseSeconds) ? queue.leaseSeconds : 60;
    const heartbeatMs = Math.max(1_000, Math.floor(leaseSeconds * 1_000 / 3));
    let heartbeatTimer = null;
    let heartbeatError = null;
    let heartbeatInFlight = false;
    const renewLease = async () => {
      if (heartbeatInFlight || heartbeatError) return;
      heartbeatInFlight = true;
      try {
        await queue.heartbeat(job.id, workerId, leaseSeconds);
      } catch (error) {
        heartbeatError = error;
      } finally {
        heartbeatInFlight = false;
      }
    };
    try {
      const payload = parseJobPayload(job.type, job.payload_version, job.payload);
      const handler = handlers[job.type];
      if (typeof handler !== "function") throw new Error("unknown_job_type");
      // A long-running job must retain its lease. Without this, another
      // worker can reclaim a job that is still persisting its immutable work.
      heartbeatTimer = setInterval(() => { void renewLease(); }, heartbeatMs);
      const result = await handler({ ...job, payload });
      if (heartbeatError) throw heartbeatError;
      await queue.complete(job.id, workerId, result);
    } catch (error) {
      const retryAfterSeconds = Number.isInteger(error?.retryAfterSeconds) && error.retryAfterSeconds >= 0 ? error.retryAfterSeconds : null;
      try {
        await queue.fail(job.id, workerId, { errorCode: errorCode(error), errorDetail: String(error?.stack ?? error).slice(0, 1_000), retryDelaySeconds: retryAfterSeconds });
      } catch (settlementError) {
        // A lost lease is expected to be settled by its current owner; do not
        // crash the worker process and turn a recoverable queue race into an outage.
        console.error(JSON.stringify({ event: "job_settlement_lost", jobId: job.id, code: errorCode(settlementError) }));
      }
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
    return true;
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(async () => {
      try { await runOnce(); } finally { schedule(); }
    }, pollMs);
  }

  return Object.freeze({
    runOnce,
    start() { schedule(); },
    stop() { stopped = true; if (timer) clearTimeout(timer); },
  });
}

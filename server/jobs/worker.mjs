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
    try {
      const payload = parseJobPayload(job.type, job.payload_version, job.payload);
      const handler = handlers[job.type];
      if (typeof handler !== "function") throw new Error("unknown_job_type");
      const result = await handler({ ...job, payload });
      await queue.complete(job.id, workerId, result);
    } catch (error) {
      await queue.fail(job.id, workerId, { errorCode: errorCode(error), errorDetail: String(error?.stack ?? error).slice(0, 1_000) });
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

import { jobIdempotencyKey } from "../jobs/payloads.mjs";

function scheduleWindow(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid_schedule_time");
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

/** Schedules due sources once per UTC hour; fetching remains worker-owned. */
export async function enqueueDueSources({ sources, queue, now = new Date(), limit = 100 }) {
  if (!sources || typeof sources.listDue !== "function" || !queue || typeof queue.enqueue !== "function") throw new Error("scheduler_dependencies_required");
  const scheduledFor = scheduleWindow(now);
  const due = await sources.listDue(limit);
  const jobs = [];
  for (const source of due) {
    const payload = { sourceId: source.id, reason: "scheduled", scheduledFor };
    const idempotencyKey = jobIdempotencyKey("scrape.source", 1, payload);
    jobs.push(await queue.enqueue({ type: "scrape.source", payloadVersion: 1, payload, idempotencyKey, resourceType: "source", resourceId: source.id }));
  }
  return Object.freeze({ scheduledFor, considered: due.length, enqueued: jobs.filter((entry) => entry.created).length, jobs: Object.freeze(jobs) });
}

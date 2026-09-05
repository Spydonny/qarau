import assert from "node:assert/strict";
import test from "node:test";
import { createQueueWorker } from "../jobs/worker.mjs";

test("queue worker completes validated jobs and dead-letters permanent handler errors", async () => {
  const events = [];
  const jobs = [
    { id: "job-1", type: "scrape.source", payload_version: 1, payload: { sourceId: "123e4567-e89b-42d3-a456-426614174000", reason: "manual", scheduledFor: "2026-09-05T10:00:00.000Z" } },
    { id: "job-2", type: "scrape.source", payload_version: 1, payload: { sourceId: "223e4567-e89b-42d3-a456-426614174000", reason: "manual", scheduledFor: "2026-09-05T10:00:00.000Z" } },
  ];
  const queue = {
    claim: async () => jobs.shift() ?? null,
    complete: async (id, _worker, result) => events.push(["complete", id, result]),
    fail: async (id, _worker, error) => events.push(["fail", id, error.errorCode]),
  };
  const worker = createQueueWorker({ queue, workerId: "test", types: ["scrape.source"], handlers: { "scrape.source": async (job) => { if (job.id === "job-2") throw new Error("invalid_job_payload"); return { version: 1 }; } } });
  assert.equal(await worker.runOnce(), true);
  assert.equal(await worker.runOnce(), true);
  assert.equal(await worker.runOnce(), false);
  assert.deepEqual(events, [["complete", "job-1", { version: 1 }], ["fail", "job-2", "invalid_job_payload"]]);
});

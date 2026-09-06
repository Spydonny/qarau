import assert from "node:assert/strict";
import test from "node:test";
import { createQueueWorker } from "../jobs/worker.mjs";

test("worker renews a long-running job lease before completing it", async () => {
  const calls = [];
  const queue = {
    leaseSeconds: 2,
    async claim() {
      return {
        id: "job-1",
        type: "discovery.run",
        payload_version: 1,
        payload: { queryGroup: "general", requestedBy: null, requestId: "00000000-0000-4000-8000-000000000001" },
      };
    },
    async heartbeat(jobId, workerId) { calls.push(["heartbeat", jobId, workerId]); },
    async complete(jobId, workerId, result) { calls.push(["complete", jobId, workerId, result]); },
    async fail(...args) { calls.push(["fail", ...args]); },
  };
  const worker = createQueueWorker({
    queue,
    workerId: "test-worker",
    types: ["discovery.run"],
    handlers: { "discovery.run": async () => { await new Promise((resolve) => setTimeout(resolve, 1_100)); return { ok: true }; } },
  });

  assert.equal(await worker.runOnce(), true);
  assert.ok(calls.some(([event]) => event === "heartbeat"));
  assert.deepEqual(calls.at(-1), ["complete", "job-1", "test-worker", { ok: true }]);
});

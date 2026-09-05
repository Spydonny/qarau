import assert from "node:assert/strict";
import test from "node:test";
import { enqueueDueSources } from "../scheduler/enqueue-due-sources.mjs";

test("scheduler creates one deterministic scrape job per due source and hour", async () => {
  const calls = [];
  const sources = { listDue: async () => [{ id: "123e4567-e89b-42d3-a456-426614174000" }, { id: "223e4567-e89b-42d3-a456-426614174000" }] };
  const queue = { enqueue: async (input) => { calls.push(input); return { created: calls.length === 1, job: { id: input.resourceId } }; } };
  const result = await enqueueDueSources({ sources, queue, now: "2026-09-05T11:34:56.000Z" });
  assert.equal(result.scheduledFor, "2026-09-05T11:00:00.000Z");
  assert.equal(result.enqueued, 1);
  assert.equal(calls[0].payload.scheduledFor, result.scheduledFor);
  assert.notEqual(calls[0].idempotencyKey, calls[1].idempotencyKey);
});

import assert from "node:assert/strict";
import test from "node:test";
import { jobIdempotencyKey, jobTypesForRole, parseJobPayload } from "../jobs/payloads.mjs";
import { retryDelaySeconds, retryableError } from "../jobs/retry-policy.mjs";
import { PostgresJobQueue } from "../jobs/queue.mjs";

test("durable job payloads are strict, versioned, and role-scoped", () => {
  const payload = { sourceId: "123e4567-e89b-12d3-a456-426614174000", reason: "manual", scheduledFor: "2026-09-05T10:00:00.000Z" };
  assert.deepEqual(parseJobPayload("scrape.source", 1, payload), payload);
  assert.throws(() => parseJobPayload("scrape.source", 1, { ...payload, arbitrary: true }));
  assert.throws(() => parseJobPayload("scrape.source", 2, payload), /unsupported_job_payload_version/);
  assert.deepEqual(jobTypesForRole("worker-scrape"), ["scrape.source"]);
  assert.equal(jobIdempotencyKey("scrape.source", 1, payload), jobIdempotencyKey("scrape.source", 1, { reason: "manual", sourceId: payload.sourceId, scheduledFor: payload.scheduledFor }));
});

test("queue rejects work whose payload is not covered by the contract", async () => {
  const queue = new PostgresJobQueue({});
  await assert.rejects(() => queue.enqueue({ type: "scrape.source", payload: { sourceId: "not-a-uuid" }, idempotencyKey: "invalid" }));
});

test("retry policy is bounded and leaves permanent errors out of the retry loop", () => {
  assert.deepEqual([1, 2, 3, 4].map((attempt) => retryDelaySeconds(attempt)), [5, 10, 20, 40]);
  assert.equal(retryDelaySeconds(20), 3_600);
  assert.equal(retryableError("timeout"), true);
  assert.equal(retryableError("unknown_job_type"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { RECONCILE_UPDATE } from "../jobs/handlers/chain-reconcile.mjs";
import { STALE_ROUNDS_QUERY, enqueueStaleRounds } from "../scheduler/enqueue-stale-rounds.mjs";
import { jobIdempotencyKey } from "../jobs/payloads.mjs";

// The reconcile loop runs unattended, so a drift in its update contract would
// surface only as scheduler noise. These tests pin the frozen descriptors and
// the stale-selection filter without needing a live database.
test("reconcile descriptors are frozen and name the access_rounds contract", () => {
  for (const descriptor of [RECONCILE_UPDATE, STALE_ROUNDS_QUERY]) {
    assert.ok(Object.isFrozen(descriptor));
    assert.equal(descriptor.collection, "access_rounds");
  }
  assert.ok(RECONCILE_UPDATE.set.includes("state"));
  assert.ok(RECONCILE_UPDATE.set.includes("bid_count"));
  assert.ok(RECONCILE_UPDATE.set.includes("decoded_state"));
  assert.ok(RECONCILE_UPDATE.set.includes("last_reconciled_at"));
});

function stubDb(rows, onFind) {
  return {
    collection: (name) => {
      assert.equal(name, "access_rounds");
      return {
        find: (filter) => {
          onFind?.(filter);
          return {
            sort: () => ({
              limit: () => ({
                project: () => ({ toArray: async () => rows.map((row) => ({ ...row })) }),
              }),
            }),
          };
        },
      };
    },
  };
}

test("the scheduler selects finalized, unreconciled rounds and enqueues nothing when none is stale", async () => {
  const seen = [];
  const db = stubDb([], (filter) => seen.push(filter));
  const calls = [];
  const queue = { enqueue: async (input) => { calls.push(input); return { created: true, job: { id: input.resourceId } }; } };

  const result = await enqueueStaleRounds({ db, queue, now: new Date("2026-09-15T12:30:40.000Z"), staleSeconds: 86_400 });

  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].state, { $in: ["upcoming", "live", "ended"] });
  assert.equal(seen[0].confirmation_status, "finalized");
  assert.ok(Array.isArray(seen[0].$or));
  assert.equal(result.considered, 0);
  assert.equal(result.enqueued, 0);
  assert.match(result.observedFor, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
});

test("stale rows are enqueued once per observation window", async () => {
  const db = stubDb([{ _id: "round-a", round_pda: "PdaA", network: "devnet" }]);
  const calls = [];
  const queue = { enqueue: async (input) => { calls.push(input); return { created: true, job: { id: input.resourceId } }; } };

  const result = await enqueueStaleRounds({ db, queue, now: new Date("2026-09-15T12:30:40.000Z") });

  assert.equal(result.observedFor, "2026-09-15T12:30:00.000Z");
  assert.equal(result.considered, 1);
  assert.equal(result.enqueued, 1);
  assert.equal(calls[0].resourceId, "round-a");
  assert.equal(calls[0].idempotencyKey, jobIdempotencyKey("chain.reconcile", 2, { network: "devnet", account: "PdaA", observedFor: "2026-09-15T12:30:00.000Z" }));
});

test("the scheduler rejects an unreadable clock", async () => {
  const db = stubDb([]);
  const queue = { enqueue: async () => ({ created: true, job: { id: "x" } }) };
  await assert.rejects(() => enqueueStaleRounds({ db, queue, now: "not-a-date" }), /invalid_schedule_time/);
});

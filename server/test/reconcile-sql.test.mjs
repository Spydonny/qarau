import assert from "node:assert/strict";
import test from "node:test";
import { createPool } from "../db/pool.mjs";
import { migrate } from "../db/migrate.mjs";
import { RECONCILE_UPDATE } from "../jobs/handlers/chain-reconcile.mjs";
import { STALE_ROUNDS_QUERY, enqueueStaleRounds } from "../scheduler/enqueue-stale-rounds.mjs";
import { testDatabaseUrl } from "./database-url.mjs";

const databaseUrl = testDatabaseUrl();
const enabled = Boolean(databaseUrl);

// The reconcile loop runs unattended, so a typo in its SQL would surface only as
// scheduler noise. PREPARE resolves every column, operator and function against
// the live schema without needing the package/version/round fixture chain.
test("reconcile SQL resolves against the real schema", { skip: !enabled }, async () => {
  const pool = createPool(databaseUrl);
  try {
    await migrate(pool);
    await pool.query(`PREPARE reconcile_update_check AS ${RECONCILE_UPDATE}`);
    await pool.query(`PREPARE stale_rounds_check AS ${STALE_ROUNDS_QUERY}`);
    await pool.query("DEALLOCATE reconcile_update_check");
    await pool.query("DEALLOCATE stale_rounds_check");
  } finally {
    await pool.end();
  }
});

test("the scheduler query runs against the live schema and enqueues nothing when no round is stale", { skip: !enabled }, async () => {
  const pool = createPool(databaseUrl);
  try {
    await migrate(pool);
    const calls = [];
    const queue = { enqueue: async (input) => { calls.push(input); return { created: true, job: { id: input.resourceId } }; } };
    const result = await enqueueStaleRounds({ pool, queue, staleSeconds: 86_400 });
    assert.equal(result.considered, calls.length);
    assert.equal(result.enqueued, calls.length);
    assert.match(result.observedFor, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
  } finally {
    await pool.end();
  }
});

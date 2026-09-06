import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { createPool } from "../db/pool.mjs";
import { migrate } from "../db/migrate.mjs";
import { createDiscoveryRunHandler } from "../jobs/handlers/discovery-run.mjs";
import { testDatabaseUrl } from "./database-url.mjs";

const databaseUrl = testDatabaseUrl();
const sourceKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

test("discovery persists live candidates once and retains discovery evidence", { skip: !databaseUrl }, async () => {
  const pool = createPool(databaseUrl);
  const suffix = randomUUID();
  const fixtureUrl = `https://example.test/${suffix}.csv`;
  const fixtureHash = createHash("sha256").update(fixtureUrl).digest();
  try {
    await migrate(pool);
    const handler = createDiscoveryRunHandler({ pool, sourceUrlKey: sourceKey, discover: async () => [{ url: fixtureUrl, name: "Live fixture", sourceType: "csv", discoveryProvider: "AUTOMATED_WEB", discoveredQuery: "logistics", expectedFields: ["timestamp", "count"], temporalCoverage: {}, updateFrequency: "DAILY" }] });
    const job = { payload: { queryGroup: "logistics", requestedBy: null, requestId: randomUUID() } };
    const first = await handler(job);
    const second = await handler(job);
    assert.equal(first.created, 1);
    assert.equal(second.created, 0);
    const sources = await pool.query("SELECT source_type, status FROM sources WHERE canonical_url_hash = $1", [fixtureHash]);
    assert.deepEqual(sources.rows.map((row) => ({ sourceType: row.source_type, status: row.status })), [{ sourceType: "csv", status: "candidate" }]);
    const evidence = await pool.query("SELECT count(*)::integer AS count FROM source_discoveries WHERE result_url_hash = $1", [fixtureHash]);
    assert.equal(evidence.rows[0].count, 2);
  } finally { await pool.end(); }
});

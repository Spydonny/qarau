import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { createDatabase } from "../db/mongo.mjs";
import { migrate } from "../db/migrate.mjs";
import { createRepositories } from "../db/repositories/index.mjs";
import { createDiscoveryRunHandler } from "../jobs/handlers/discovery-run.mjs";

const uri = process.env.TEST_MONGODB_URI;
const dbName = `qarau_test_${Date.now().toString(36)}${process.pid.toString(36)}`;
const sourceKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

test("discovery persists live candidates once and retains discovery evidence", { skip: !uri }, async () => {
  const { db, close } = await createDatabase(uri, dbName);
  const suffix = randomUUID();
  const fixtureUrl = `https://example.test/${suffix}.csv`;
  const fixtureHash = createHash("sha256").update(fixtureUrl).digest();
  try {
    await migrate(db);
    const repositories = createRepositories(db);
    const handler = createDiscoveryRunHandler({ db, sourceUrlKey: sourceKey, discover: async () => [{ url: fixtureUrl, name: "Live fixture", sourceType: "csv", discoveryProvider: "AUTOMATED_WEB", discoveredQuery: "logistics", expectedFields: ["timestamp", "count"], temporalCoverage: {}, updateFrequency: "DAILY" }] });
    const job = { payload: { queryGroup: "logistics", requestedBy: null, requestId: randomUUID() } };
    const first = await handler(job);
    const second = await handler(job);
    assert.equal(first.created, 1);
    assert.equal(second.created, 0);
    const stored = await repositories.sources.findByCanonicalHash(fixtureHash);
    assert.deepEqual({ sourceType: stored.source_type, status: stored.status }, { sourceType: "csv", status: "candidate" });
    assert.equal(await repositories.discoveries.countWhere({ result_url_hash: fixtureHash }), 2);
  } finally { await close(); }
});

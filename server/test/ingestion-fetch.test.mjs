import assert from "node:assert/strict";
import test from "node:test";
import { captureRawSnapshot } from "../ingestion/fetch.mjs";
import { safeResponseHeaders } from "../lib/url-policy.mjs";

test("raw capture stores exact received bytes before parsing", async () => {
  const stored = [];
  const bytes = Buffer.from('{"a":1}\n', "utf8");
  const captured = await captureRawSnapshot({
    sourceId: "123e4567-e89b-42d3-a456-426614174000",
    snapshotId: "223e4567-e89b-42d3-a456-426614174000",
    url: "https://example.test/data",
    artifactStore: { putOnce: async (value) => { stored.push(value); } },
    requestBytes: async () => ({ url: "https://example.test/data", contentType: "application/json", headers: { etag: "v1" }, bytes }),
  });
  assert.equal(stored.length, 1);
  assert.equal(stored[0].key, captured.rawObjectKey);
  assert.equal(stored[0].bytes.equals(bytes), true);
  assert.equal(captured.contentLength, bytes.length);
  assert.match(captured.rawHash, /^[0-9a-f]{64}$/);
});

test("raw capture retains only a bounded allowlist of response headers", () => {
  assert.deepEqual(safeResponseHeaders({ ETag: "abc", "Set-Cookie": "secret", "Last-Modified": "yesterday", "X-Trace": "private" }), { etag: "abc", "last-modified": "yesterday" });
});

import assert from "node:assert/strict";
import test from "node:test";
import { decryptSourceUrl, encryptSourceUrl } from "../security/source-url.mjs";

const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

test("source URLs are encrypted at rest and reject wrong keys", () => {
  const encrypted = encryptSourceUrl("https://example.test/api?series=rain", key);
  assert.notEqual(encrypted.toString("utf8").includes("example.test"), true);
  assert.equal(decryptSourceUrl(encrypted, key), "https://example.test/api?series=rain");
  assert.throws(() => decryptSourceUrl(encrypted, "f".repeat(64)), /source_url_decryption_failed/);
});

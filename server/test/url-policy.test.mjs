import assert from "node:assert/strict";
import test from "node:test";
import { isPublicAddress, validateExternalUrl } from "../lib/url-policy.mjs";

test("validateExternalUrl permits only public HTTP(S) URLs", () => {
  assert.equal(validateExternalUrl("https://example.com/catalog").hostname, "example.com");
  for (const url of [
    "file:///etc/passwd",
    "http://localhost:8787/api",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.5/data.csv",
    "http://[::ffff:7f00:1]/",
    "http://[fe80::1]/",
  ]) {
    assert.throws(() => validateExternalUrl(url));
  }
});

test("reserved and mapped network addresses are not public destinations", () => {
  for (const address of ["192.168.1.1", "198.51.100.10", "203.0.113.2", "::ffff:7f00:1", "ff02::1"]) assert.equal(isPublicAddress(address), false);
  assert.equal(isPublicAddress("93.184.216.34"), true);
});

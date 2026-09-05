import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  HASH_DOMAINS,
  SOLANA_ACCOUNT_LAYOUTS,
  assertAccountSpaces,
  canonicalDecimal,
  canonicalJson,
  canonicalJsonlBytes,
  datasetIdHash,
  hashCanonicalArtifact,
  validateAccessPolicy,
} from "../domain/canonical-artifacts.mjs";

const fixtureUrl = (name) => new URL(`../../contracts/fixtures/${name}`, import.meta.url);

test("canonical artifact fixtures are stable and cross-language ready", async () => {
  const policy = JSON.parse(await readFile(fixtureUrl("access-policy-v1.json"), "utf8"));
  const manifest = JSON.parse(await readFile(fixtureUrl("analysis-manifest-v1.json"), "utf8"));
  const expected = JSON.parse(await readFile(fixtureUrl("canonical-hashes-v1.json"), "utf8"));

  assert.deepEqual(validateAccessPolicy(policy), policy);
  assert.equal(hashCanonicalArtifact(HASH_DOMAINS.accessPolicy, policy), expected.access_policy_hash);
  assert.equal(hashCanonicalArtifact(HASH_DOMAINS.analysisManifest, manifest), expected.analysis_manifest_hash);
  assert.equal(datasetIdHash(expected.dataset_uuid), expected.dataset_id_hash);
});

test("canonical JSON and JSONL reject ambiguous numeric representations", () => {
  assert.equal(canonicalJson({ z: "1.2", a: 1 }), '{"a":1,"z":"1.2"}');
  assert.equal(canonicalJsonlBytes([{ timestamp: "2026-01-01T00:00:00.000Z", value: "1.2" }]).at(-1), 10);
  assert.equal(canonicalDecimal("-0.000"), "0");
  assert.equal(canonicalDecimal("12.3400"), "12.34");
  assert.throws(() => canonicalJson({ value: 1.25 }), /safe_integers/);
  assert.throws(() => canonicalDecimal("1e3"), /invalid_canonical_decimal/);
});

test("Solana account spaces include the discriminator and every frozen field", () => {
  assert.equal(assertAccountSpaces(), true);
  assert.deepEqual(Object.fromEntries(Object.entries(SOLANA_ACCOUNT_LAYOUTS).map(([name, layout]) => [name, layout.space])), {
    Registry: 76,
    DatasetCommitment: 271,
    Sale: 156,
    AccessGrant: 159,
  });
});

test("vertical tracer contains only production authorities and all tier/version proofs", async () => {
  const tracer = JSON.parse(await readFile(new URL("../../contracts/tracer-v1.json", import.meta.url), "utf8"));
  const stageIds = new Set(tracer.stages.map(({ id }) => id));
  assert.equal(tracer.stages.length, stageIds.size);
  assert.ok(["solana_sale_account", "solana_access_grant_account"].every((authority) => Object.values(tracer.authority).includes(authority)));
  assert.ok(["early_v2", "delayed_v1", "ungranted_403", "immutable_v3"].every((id) => stageIds.has(id)));
  assert.equal(JSON.stringify(tracer).includes("mock"), false);
  assert.ok(tracer.stages.every(({ work_item, state }) => /^INT-\d{3}$/.test(work_item) && state === "pending"));
});

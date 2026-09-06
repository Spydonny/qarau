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
    AccessRound: 1696,
    Bid: 91,
    AccessEntitlement: 167,
  });
});

test("vertical tracer contains only production authorities and all tier/version proofs", async () => {
  const tracer = JSON.parse(await readFile(new URL("../../contracts/tracer-v1.json", import.meta.url), "utf8"));
  const stageIds = new Set(tracer.stages.map(({ id }) => id));
  assert.equal(tracer.stages.length, stageIds.size);
  assert.ok(["solana_access_round_account", "solana_access_entitlement_account"].every((authority) => Object.values(tracer.authority).includes(authority)));
  assert.ok(["early_v2", "delayed_v1", "unentitled_403", "immutable_v3"].every((id) => stageIds.has(id)));
  assert.equal(JSON.stringify(tracer).includes("mock"), false);
  assert.ok(tracer.stages.every(({ work_item, state }) => /^INT-\d{3}$/.test(work_item) && state === "pending"));
});

test("API contract separates public, wallet, owner, and finalized-entitlement boundaries", async () => {
  const contract = JSON.parse(await readFile(new URL("../../contracts/api-v1.json", import.meta.url), "utf8"));
  const key = ({ method, path }) => `${method} ${path}`;
  const endpoints = new Map(contract.endpoints.map((endpoint) => [key(endpoint), endpoint]));
  assert.equal(endpoints.get("GET /opportunities").security, "public");
  assert.equal(endpoints.get("POST /discovery/jobs").security, "owner");
  assert.equal(endpoints.get("POST /access-rounds/{roundPda}/bid-transaction").security, "wallet");
  for (const role of ["metadata", "report", "data", "export"]) {
    assert.equal(endpoints.get(`GET /dataset/{packageId}/${role}`).security, "wallet_finalized_entitlement");
  }
  assert.deepEqual(contract.schemas.BidTransactionRequest.forbidden, ["bidder", "treasury", "bid_pda", "program_id"]);
  assert.ok(contract.schemas.ProtectedArtifact.forbidden.includes("signed_url"));
});

test("evidence bundle schema freezes exactly twenty live-demo steps", async () => {
  const schema = JSON.parse(await readFile(new URL("../../contracts/schemas/evidence-bundle-v1.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.properties.steps.minItems, 20);
  assert.equal(schema.properties.steps.maxItems, 20);
  assert.equal(schema.properties.steps.items.properties.number.maximum, 20);
  assert.equal(schema.properties.steps.items.additionalProperties, false);
});

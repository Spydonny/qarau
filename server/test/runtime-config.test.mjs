import assert from "node:assert/strict";
import test from "node:test";
import { SERVICE_ROLES, loadServiceConfig, publicRuntimeSummary } from "../runtime/config.mjs";

const integrated = {
  QARAU_RUNTIME_MODE: "integrated",
  DATABASE_URL: "postgresql://role:password@postgres:5432/qarau",
  S3_ENDPOINT: "http://object-storage:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "qarau-private",
  S3_ACCESS_KEY_ID: "qarau-api",
  S3_SECRET_ACCESS_KEY: "local-secret",
  SOURCE_URL_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  WALLET_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  SOLANA_RPC_URL: "https://api.devnet.solana.com",
  SOLANA_PROGRAM_ID: "5n92bg5CrZrt956eXmakgAiqesbfFav7mdNqsfk8Ex3u",
  PUBLISHER_SIGNER_URL: "http://publisher-signer:8796",
  PUBLISHER_SIGNER_TOKEN: "local-token-change-me",
  SOLANA_PUBLISHER_KEY_PATH: "/run/secrets/publisher.json",
};

test("every frozen service role has an environment contract", () => {
  assert.deepEqual(SERVICE_ROLES, ["api", "worker-discovery", "worker-scrape", "worker-analysis", "worker-chain", "scheduler", "publisher-signer"]);
  for (const role of SERVICE_ROLES) {
    const environment = { ...integrated };
    if (role !== "publisher-signer") delete environment.SOLANA_PUBLISHER_KEY_PATH;
    assert.equal(loadServiceConfig(role, environment).role, role);
  }
});

test("API legacy mode remains available during strangler migration", () => {
  const config = loadServiceConfig("api", {});
  assert.equal(config.runtimeMode, "legacy");
  assert.equal(publicRuntimeSummary(config).persistence, "encrypted-local-migration-mode");
});

test("integrated services fail closed on missing credentials and Mainnet RPC", () => {
  assert.throws(() => loadServiceConfig("worker-analysis", { QARAU_RUNTIME_MODE: "integrated" }));
  const apiEnvironment = { ...integrated, SOLANA_RPC_URL: "https://api.mainnet-beta.solana.com" };
  delete apiEnvironment.SOLANA_PUBLISHER_KEY_PATH;
  assert.throws(() => loadServiceConfig("api", apiEnvironment), /MVP supports only/);
});

test("publisher key material is rejected outside the signer", () => {
  assert.throws(() => loadServiceConfig("api", integrated), /publisher_key_forbidden/);
  assert.equal(loadServiceConfig("publisher-signer", integrated).values.SOLANA_PUBLISHER_KEY_PATH, "/run/secrets/publisher.json");
});

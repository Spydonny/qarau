import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

const baseEnvironment = {
  QARAU_RUNTIME_MODE: "integrated",
  DATABASE_URL: "postgresql://role:password@postgres:5432/qarau",
  S3_ENDPOINT: "http://object-storage:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "qarau-private",
  S3_ACCESS_KEY_ID: "qarau-worker",
  S3_SECRET_ACCESS_KEY: "local-secret",
  SOURCE_URL_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  WALLET_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  SOLANA_RPC_URL: "https://api.devnet.solana.com",
  SOLANA_PROGRAM_ID: "5n92bg5CrZrt956eXmakgAiqesbfFav7mdNqsfk8Ex3u",
  PUBLISHER_SIGNER_URL: "http://publisher-signer:8796",
  PUBLISHER_SIGNER_TOKEN: "local-token-change-me",
  SOLANA_PUBLISHER_KEY_PATH: "/run/secrets/publisher.json",
};

async function startAndProbe(role, port) {
  const environment = { ...process.env, ...baseEnvironment, SERVICE_HEALTH_PORT: String(port) };
  if (role !== "publisher-signer") delete environment.SOLANA_PUBLISHER_KEY_PATH;
  const child = spawn(process.execPath, ["server/runtime/worker-entry.mjs", role], {
    cwd: process.cwd(),
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`service_start_timeout:${role}:${stderr}`)), 5_000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`service_exited:${role}:${code}:${stderr}`));
    });
    child.stdout.on("data", (chunk) => {
      if (chunk.toString("utf8").includes('"event":"service_ready"')) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  try {
    await ready;
    const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.role, role);
    assert.equal(body.mode, "integrated");
    assert.equal(body.capabilities, "foundation-only");
  } finally {
    child.kill();
  }
}

test("all private service foundations start with their role-scoped contracts", async () => {
  const roles = ["worker-discovery", "worker-scrape", "worker-analysis", "worker-chain", "scheduler", "publisher-signer"];
  await Promise.all(roles.map((role, index) => startAndProbe(role, 18_791 + index)));
});

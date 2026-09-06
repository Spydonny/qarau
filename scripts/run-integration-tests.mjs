import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

const docker = process.platform === "win32" ? "docker.exe" : "docker";
const compose = (...args) => spawnSync(docker, ["compose", "--profile", "test", ...args], { stdio: "inherit" });

const started = compose("up", "-d", "--wait", "--force-recreate", "postgres-test");
if (started.status !== 0) process.exit(started.status ?? 1);

const databaseUrl = "postgresql://qarau_owner:qarau-owner-local-only@127.0.0.1:55432/qarau_test";
let reachable = false;
for (let attempt = 0; attempt < 60 && !reachable; attempt += 1) {
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    reachable = true;
  } catch {
    await delay(250);
  } finally {
    await client.end().catch(() => undefined);
  }
}
if (!reachable) {
  compose("rm", "--stop", "--force", "postgres-test");
  throw new Error("isolated_test_database_unreachable");
}

let status = 1;
try {
  const testFiles = readdirSync(new URL("../server/test/", import.meta.url))
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => `server/test/${name}`);
  const result = spawnSync(process.execPath, ["--test", ...testFiles], {
    stdio: "inherit",
    env: {
      ...process.env,
      TEST_DATABASE_URL: databaseUrl,
    },
  });
  status = result.status ?? 1;
} finally {
  compose("rm", "--stop", "--force", "postgres-test");
}

process.exit(status);

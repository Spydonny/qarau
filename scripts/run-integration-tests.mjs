import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const uri = process.env.TEST_MONGODB_URI;
if (!uri) {
  console.error("TEST_MONGODB_URI is required (e.g. mongodb://127.0.0.1:27017/qarau_test)");
  process.exit(1);
}

const testFiles = readdirSync(new URL("../server/test/", import.meta.url))
  .filter((name) => name.endsWith(".test.mjs"))
  .map((name) => `server/test/${name}`);
const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
  env: {
    ...process.env,
    TEST_MONGODB_URI: uri,
  },
});

process.exit(result.status ?? 1);

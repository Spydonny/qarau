import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const worker = join(dirname(fileURLToPath(import.meta.url)), "devnet-signer.mjs");

export function commitMerkleRoot(intent) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker], { cwd: process.cwd(), env: { PATH: process.env.PATH, DEV_AUTO_AIRDROP: process.env.DEV_AUTO_AIRDROP || "false" }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const output = []; const errors = [];
    const timeout = setTimeout(() => child.kill(), 60_000);
    child.stdout.on("data", (chunk) => output.push(chunk)); child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) { reject(new Error(Buffer.concat(errors).toString("utf8") || "signer_failed")); return; }
      try { resolve(JSON.parse(Buffer.concat(output).toString("utf8"))); } catch { reject(new Error("invalid_signer_response")); }
    });
    child.stdin.end(JSON.stringify(intent));
  });
}

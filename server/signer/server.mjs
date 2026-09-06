import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { loadServiceConfig, publicRuntimeSummary } from "../runtime/config.mjs";
import { publisherSigner } from "./key-store.mjs";
import { publishPackageOnChain, settleAccessRoundOnChain } from "./publisher.mjs";

const config = loadServiceConfig("publisher-signer");
const token = config.values.PUBLISHER_SIGNER_TOKEN;
const signer = await publisherSigner(config.values.SOLANA_PUBLISHER_KEY_PATH);
function allowed(request) {
  const received = Buffer.from(String(request.headers["x-publisher-token"] ?? "")); const expected = Buffer.from(token);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
async function body(request) { const chunks = []; for await (const chunk of request) { chunks.push(chunk); if (chunks.reduce((size, value) => size + value.length, 0) > 8_192) throw new Error("publisher_request_too_large"); } return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
const server = createServer(async (request, response) => {
  if (request.url === "/health/ready") { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ status: "ready", ...publicRuntimeSummary(config), signer: signer.address })); return; }
  if (request.method !== "POST" || !["/publish", "/settle"].includes(request.url) || !allowed(request)) { response.writeHead(404, { "content-type": "application/json" }); response.end('{"error":"not_found"}'); return; }
  try {
    const input = await body(request);
    const result = request.url === "/publish"
      ? await publishPackageOnChain({ signer, rpcUrl: config.values.SOLANA_RPC_URL, programId: config.values.SOLANA_PROGRAM_ID, input })
      : await settleAccessRoundOnChain({ signer, rpcUrl: config.values.SOLANA_RPC_URL, programId: config.values.SOLANA_PROGRAM_ID, roundPda: String(input?.roundPda ?? "") });
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(result));
  }
  catch (error) { response.writeHead(400, { "content-type": "application/json" }); response.end(JSON.stringify({ error: String(error.message ?? "publisher_failed") })); }
});
server.listen(config.healthPort, "0.0.0.0", () => console.log(JSON.stringify({ event: "publisher_ready", healthPort: config.healthPort, signer: signer.address })));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));

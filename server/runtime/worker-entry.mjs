import { createServer } from "node:http";
import { loadServiceConfig, publicRuntimeSummary } from "./config.mjs";

const role = process.argv[2];
const config = loadServiceConfig(role);
const summary = publicRuntimeSummary(config);

const server = createServer((request, response) => {
  if (request.url !== "/health/ready") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"error":"not_found"}');
    return;
  }
  response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify({ status: "ready", ...summary }));
});

server.listen(config.healthPort, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "service_ready", healthPort: config.healthPort, ...summary }));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

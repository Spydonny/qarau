import { createServer } from "node:http";
import { createPool } from "../db/pool.mjs";
import { PostgresJobQueue } from "../jobs/queue.mjs";
import { createScrapeSourceHandler } from "../jobs/handlers/scrape-source.mjs";
import { createQueueWorker } from "../jobs/worker.mjs";
import { S3ArtifactStore } from "../storage/artifact-store.mjs";
import { loadServiceConfig, publicRuntimeSummary } from "./config.mjs";

const role = process.argv[2];
const config = loadServiceConfig(role);
const summary = publicRuntimeSummary(config);
let pool = null;
let worker = null;

if (role === "worker-scrape" && process.env.QARAU_WORKER_EXECUTE === "true") {
  pool = createPool(config.values.DATABASE_URL);
  const queue = new PostgresJobQueue(pool);
  worker = createQueueWorker({
    queue,
    workerId: `${role}:${process.pid}`,
    types: ["scrape.source"],
    handlers: { "scrape.source": createScrapeSourceHandler({ pool, artifactStore: S3ArtifactStore.fromEnvironment(process.env) }) },
  });
  worker.start();
}

const server = createServer((request, response) => {
  if (request.url !== "/health/ready") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"error":"not_found"}');
    return;
  }
  response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify({ status: "ready", ...summary, workExecution: worker ? "enabled" : "foundation_only" }));
});

server.listen(config.healthPort, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "service_ready", healthPort: config.healthPort, ...summary }));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    worker?.stop();
    server.close(async () => { await pool?.end(); process.exit(0); });
  });
}

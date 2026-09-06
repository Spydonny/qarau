import { createServer } from "node:http";
import { createPool } from "../db/pool.mjs";
import { PostgresJobQueue } from "../jobs/queue.mjs";
import { createScrapeSourceHandler } from "../jobs/handlers/scrape-source.mjs";
import { createDiscoveryRunHandler } from "../jobs/handlers/discovery-run.mjs";
import { createAnalysisRunHandler } from "../jobs/handlers/analysis-run.mjs";
import { createChainPublishHandler } from "../jobs/handlers/chain-publish.mjs";
import { createChainSettleHandler } from "../jobs/handlers/chain-settle.mjs";
import { createRepositories } from "../db/repositories/index.mjs";
import { enqueueDueSources } from "../scheduler/enqueue-due-sources.mjs";
import { createQueueWorker } from "../jobs/worker.mjs";
import { S3ArtifactStore } from "../storage/artifact-store.mjs";
import { loadServiceConfig, publicRuntimeSummary } from "./config.mjs";

const role = process.argv[2];
const config = loadServiceConfig(role);
const summary = publicRuntimeSummary(config);
let pool = null;
let worker = null;
let stopScheduler = null;

if (["worker-scrape", "worker-discovery", "worker-analysis", "worker-chain"].includes(role) && process.env.QARAU_WORKER_EXECUTE === "true") {
  pool = createPool(config.values.DATABASE_URL);
  const queue = new PostgresJobQueue(pool);
  const handlers = role === "worker-scrape"
    ? { "scrape.source": createScrapeSourceHandler({ pool, artifactStore: S3ArtifactStore.fromEnvironment(process.env) }) }
    : role === "worker-discovery"
      ? { "discovery.run": createDiscoveryRunHandler({ pool }) }
      : role === "worker-analysis"
        ? { "analysis.run": createAnalysisRunHandler({ pool, artifactStore: S3ArtifactStore.fromEnvironment(process.env) }) }
        : (() => {
          const publish = createChainPublishHandler({ pool, publisherSignerUrl: config.values.PUBLISHER_SIGNER_URL, publisherSignerToken: config.values.PUBLISHER_SIGNER_TOKEN });
          const settle = createChainSettleHandler({ pool, publisherSignerUrl: config.values.PUBLISHER_SIGNER_URL, publisherSignerToken: config.values.PUBLISHER_SIGNER_TOKEN, rpcUrl: config.values.SOLANA_RPC_URL, programId: config.values.SOLANA_PROGRAM_ID });
          return { "chain.publish": async (job) => {
            try { return await publish(job); }
            catch (error) { await pool.query("UPDATE dataset_packages SET status = 'publication_failed' WHERE id = $1 AND status = 'commit_pending'", [job.payload.packageId]); throw error; }
          }, "chain.settle": settle };
        })();
  worker = createQueueWorker({
    queue,
    workerId: `${role}:${process.pid}`,
    types: Object.keys(handlers),
    handlers,
  });
  worker.start();
}

if (role === "scheduler" && process.env.QARAU_WORKER_EXECUTE === "true") {
  pool = createPool(config.values.DATABASE_URL);
  const queue = new PostgresJobQueue(pool);
  const run = async () => enqueueDueSources({ sources: createRepositories(pool).sources, queue }).catch((error) => console.error(JSON.stringify({ event: "scheduler_error", error: String(error.message) })));
  await run();
  const timer = setInterval(run, 60_000);
  stopScheduler = () => clearInterval(timer);
}

const server = createServer((request, response) => {
  if (request.url !== "/health/ready") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"error":"not_found"}');
    return;
  }
  response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify({ status: "ready", ...summary, workExecution: worker || stopScheduler ? "enabled" : "foundation_only" }));
});

server.listen(config.healthPort, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "service_ready", healthPort: config.healthPort, ...summary }));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    worker?.stop(); stopScheduler?.();
    server.close(async () => { await pool?.end(); process.exit(0); });
  });
}

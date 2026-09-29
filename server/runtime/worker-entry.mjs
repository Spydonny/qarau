import { createServer } from "node:http";
import { createDatabase } from "../db/mongo.mjs";
import { MongoJobQueue } from "../jobs/queue.mjs";
import { createScrapeSourceHandler } from "../jobs/handlers/scrape-source.mjs";
import { createDiscoveryRunHandler } from "../jobs/handlers/discovery-run.mjs";
import { createAnalysisRunHandler } from "../jobs/handlers/analysis-run.mjs";
import { createChainPublishHandler } from "../jobs/handlers/chain-publish.mjs";
import { createChainSettleHandler } from "../jobs/handlers/chain-settle.mjs";
import { createChainPauseHandler } from "../jobs/handlers/chain-pause.mjs";
import { createChainReconcileHandler } from "../jobs/handlers/chain-reconcile.mjs";
import { createRepositories } from "../db/repositories/index.mjs";
import { enqueueDueSources } from "../scheduler/enqueue-due-sources.mjs";
import { enqueueStaleRounds } from "../scheduler/enqueue-stale-rounds.mjs";
import { createQueueWorker } from "../jobs/worker.mjs";
import { S3ArtifactStore } from "../storage/artifact-store.mjs";
import { loadServiceConfig, publicRuntimeSummary } from "./config.mjs";

const role = process.argv[2];
const config = loadServiceConfig(role);
const summary = publicRuntimeSummary(config);
let database = null;
let db = null;
let worker = null;
let stopScheduler = null;

if (["worker-scrape", "worker-discovery", "worker-analysis", "worker-chain"].includes(role) && process.env.QARAU_WORKER_EXECUTE === "true") {
  database = await createDatabase(config.values.MONGODB_URI, config.values.MONGODB_DB ?? "qarau");
  db = database.db;
  const queue = new MongoJobQueue(db);
  const handlers = role === "worker-scrape"
    ? { "scrape.source": createScrapeSourceHandler({ db, artifactStore: S3ArtifactStore.fromEnvironment(process.env) }) }
    : role === "worker-discovery"
      ? { "discovery.run": createDiscoveryRunHandler({ db }) }
      : role === "worker-analysis"
        ? { "analysis.run": createAnalysisRunHandler({ db, artifactStore: S3ArtifactStore.fromEnvironment(process.env) }) }
        : (() => {
          const publish = createChainPublishHandler({ db, publisherSignerUrl: config.values.PUBLISHER_SIGNER_URL, publisherSignerToken: config.values.PUBLISHER_SIGNER_TOKEN });
          const settle = createChainSettleHandler({ db, publisherSignerUrl: config.values.PUBLISHER_SIGNER_URL, publisherSignerToken: config.values.PUBLISHER_SIGNER_TOKEN, rpcUrl: config.values.SOLANA_RPC_URL, programId: config.values.SOLANA_PROGRAM_ID });
          return { "chain.publish": async (job) => {
            try { return await publish(job); }
            catch (error) { await db.collection("dataset_packages").updateOne({ _id: job.payload.packageId, status: "commit_pending" }, { $set: { status: "publication_failed" } }); throw error; }
          }, "chain.settle": settle, "chain.pause": createChainPauseHandler({ db, publisherSignerUrl: config.values.PUBLISHER_SIGNER_URL, publisherSignerToken: config.values.PUBLISHER_SIGNER_TOKEN }), "chain.reconcile": createChainReconcileHandler({ db, rpcUrl: config.values.SOLANA_RPC_URL }) };
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
  database = await createDatabase(config.values.MONGODB_URI, config.values.MONGODB_DB ?? "qarau");
  db = database.db;
  const queue = new MongoJobQueue(db);
  const sources = createRepositories(db).sources;
  // Each loop reports independently: a failing discovery schedule must not
  // mask a failing reconcile, and neither may stop the other from running.
  const loops = Object.freeze({ "due-sources": () => enqueueDueSources({ sources, queue }), "stale-rounds": () => enqueueStaleRounds({ db, queue }) });
  const run = async () => {
    for (const [name, loop] of Object.entries(loops)) {
      await loop().catch((error) => console.error(JSON.stringify({ event: "scheduler_error", loop: name, error: String(error.message) })));
    }
  };
  await run();
  const timer = setInterval(async () => {
    try { const q = new MongoJobQueue(db); await q.recoverExpired(); } catch {}
    await run();
  }, 60_000);
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
    server.close(async () => { await database?.close(); process.exit(0); });
  });
}

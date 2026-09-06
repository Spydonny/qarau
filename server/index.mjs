import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { authBanner, initOwner, registerAuthRoutes, requireCsrf, requireOwner } from "./auth.mjs";
import { QarauService } from "./qarau-service.mjs";
import { loadServiceConfig, publicRuntimeSummary } from "./runtime/config.mjs";
import { createPool } from "./db/pool.mjs";
import { S3ArtifactStore } from "./storage/artifact-store.mjs";
import { createV1Router } from "./api/v1.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// Deliberately API_PORT rather than PORT: dev tooling routinely sets PORT for
// the web server, and inheriting it makes the API try to bind Vite's port.
// Both then land on the same port and the built index.html gets served over
// the dev server, which fails in a thoroughly confusing way.
const runtimeConfig = loadServiceConfig("api");
const runtimeSummary = publicRuntimeSummary(runtimeConfig);
const PORT = runtimeConfig.healthPort;

const app = express();
const qarau = new QarauService();
await qarau.init();
app.disable("x-powered-by");
// Behind a proxy the client address is needed for login throttling.
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

/**
 * The interface is hosted separately, so every call arrives cross-origin and
 * carries the session cookie. Credentialed requests cannot be answered with a
 * wildcard, so the caller's own origin is echoed back.
 *
 * ALLOWED_ORIGIN pins the only separately hosted front end. Same-origin
 * deployments do not need CORS at all.
 */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = process.env.ALLOWED_ORIGIN;
  if (origin && allowed && origin === allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Vary", "Origin");
  }
  // A JSON body makes the browser preflight; answer it before anything else.
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  // The React UI uses style properties for layout. Permit styles only; scripts,
  // connections, images, frames and every other resource remain self-only.
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  // Nothing here should ever be cached by an intermediary.
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/api/health", (_req, res) => res.json({ status: "ok", ...runtimeSummary, network: "solana-devnet", timestamp: new Date().toISOString() }));
app.get("/api/openapi.json", (_req, res) => res.json({
  openapi: "3.1.0",
  info: { title: "QARAU private API", version: "0.3.0" },
  paths: {
    "/api/auth/login": { post: { summary: "Create owner session" } },
    "/api/qarau/sources": { get: { summary: "Filter and paginate sources" } },
    "/api/qarau/sources/discover": { post: { summary: "Run bounded provider discovery" } },
    "/api/qarau/sources/{id}": { get: { summary: "Read authorized source detail" } },
    "/api/qarau/sources/{id}/parse": { post: { summary: "Queue hostile-page parsing" } },
    "/api/qarau/sources/{id}/analyze": { post: { summary: "Queue structured semantic analysis" } },
    "/api/qarau/sources/{id}/test": { post: { summary: "Queue leakage-safe Alpha Test" } },
    "/api/qarau/jobs/{id}": { get: { summary: "Read job progress" } },
    "/api/qarau/commitments/epoch": { post: { summary: "Development-only immediate Devnet epoch" } },
  },
}));

registerAuthRoutes(app);

// The legacy owner UI remains mounted during migration, while /api/v1 is the
// durable production path. Its data, sessions and artifacts all come from the
// integrated services, never the encrypted prototype store.
if (runtimeConfig.runtimeMode === "integrated") {
  const integratedPool = createPool(runtimeConfig.values.DATABASE_URL);
  const integratedArtifacts = S3ArtifactStore.fromEnvironment(process.env);
  app.use("/api/v1", createV1Router({
    pool: integratedPool,
    artifactStore: integratedArtifacts,
    solana: { rpcUrl: runtimeConfig.values.SOLANA_RPC_URL, programId: runtimeConfig.values.SOLANA_PROGRAM_ID },
    ownerMiddleware: requireOwner,
    csrfMiddleware: requireCsrf,
    publicOrigin: process.env.PUBLIC_APP_ORIGIN ?? "http://localhost:5173",
  }));
}

const operationBuckets = new Map();
function operationLimit(name, maximum, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${req.owner?.id ?? req.ip}`;
    const current = operationBuckets.get(key);
    const timestamp = Date.now();
    const bucket = !current || current.resetAt <= timestamp ? { count: 0, resetAt: timestamp + windowMs } : current;
    bucket.count += 1; operationBuckets.set(key, bucket);
    if (bucket.count > maximum) { res.setHeader("Retry-After", Math.ceil((bucket.resetAt - timestamp) / 1_000)); res.status(429).json({ error: "operation_rate_limited" }); return; }
    next();
  };
}

/* ============================================================
   RESEARCH ROUTES
   Every one is behind requireOwner. The router is mounted as a
   whole so a new endpoint cannot be added unprotected by
   forgetting the middleware on an individual route.
   ============================================================ */

const research = express.Router();
research.use(requireOwner);
research.use(requireCsrf);

/**
 * Which targets and universes the engine will accept.
 *
 * Served rather than hardcoded in the client on purpose: the list of assets
 * under research is itself sensitive, and anything compiled into the bundle
 * is readable by anyone who can fetch the page.
 */
research.get("/config", (_req, res) => {
  res.json({
    targets: qarau.options().targets.filter((target) => target.configured).map((target) => target.symbol),
    universes: ["ALL AVAILABLE", "ENERGY + INDUSTRY", "PORTS + LOGISTICS", "WEATHER"],
    horizons: ["1D", "3D", "7D", "14D"],
  });
});

research.get("/signals", (_req, res) => {
  const signals = qarau.store.state.tests.map((test) => {
    const source = qarau.store.state.sources.find((item) => item.id === test.sourceId);
    return { id: test.id, status: test.evidenceScore >= 70 ? "ACTIVE" : test.evidenceScore >= 45 ? "WATCHLIST" : "CANDIDATE", name: source?.name ?? "Archived source", target: test.target, bestLag: test.bestLag, oosPassed: test.deltaR2 > 0 && test.folds.filter((fold) => fold.deltaR2 > 0).length >= 2, baselineR2: test.baseline.r2, augmentedR2: test.augmented.r2, stability: test.stabilityAcrossFolds * 100, evidenceScore: test.evidenceScore, sampleSize: test.sampleSize, correlation: test.crossCorrelation, warnings: test.warnings, createdAt: test.createdAt };
  });
  const count = (status) => signals.filter((signal) => signal.status === status).length;
  res.json({ stats: { active: count("ACTIVE"), watchlist: count("WATCHLIST"), degrading: 0, retired: 0, candidate: count("CANDIDATE"), rejected: 0, total: signals.length }, signals });
});

research.get("/signals/:id", (req, res) => {
  const test = qarau.store.state.tests.find((item) => item.id === req.params.id);
  const source = test && qarau.store.state.sources.find((item) => item.id === test.sourceId);
  if (!test || !source) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ test, source: qarau.view(source), analysis: source.analysis });
});

research.get("/datasets", (_req, res) => {
  res.json({ datasets: qarau.store.state.sources.filter((source) => source.status !== "ARCHIVED" && source.dataset).map((source) => ({ id: source.dataset.snapshotId, sourceId: source.id, name: source.name, category: source.category, provider: source.dataset.provenance.provider, region: source.region, rows: source.dataset.rows.length, createdAt: source.dataset.createdAt, digest: source.dataset.digest, quality: source.dataset.quality })) });
});

research.get("/gaps", (_req, res) => {
  res.json({ gaps: [] });
});

research.get("/runs", (_req, res) => {
  res.json({ runs: qarau.store.state.tests.map((test) => {
    const source = qarau.store.state.sources.find((item) => item.id === test.sourceId);
    const passed = test.deltaR2 > 0 && test.folds.filter((fold) => fold.deltaR2 > 0).length >= 2;
    return { id: test.id, target: test.target, horizon: `${test.horizon}D`, universe: source?.category ?? "ARCHIVED", date: test.createdAt, status: passed ? "COMPLETE" : "REJECTED", funnel: { datasets: 1, features: test.correlationByLag.length, tested: test.correlationByLag.length, passedFilters: test.sampleSize >= 48 ? 1 : 0, passedRobustness: test.stabilityAcrossFolds >= .5 ? 1 : 0, passedOOS: passed ? 1 : 0, candidates: passed ? 1 : 0 }, producedSignalIds: passed ? [test.id] : [], survivors: passed ? 1 : 0, rejected: passed ? [] : [{ name: source?.name ?? "Source test", reason: test.warnings.join(", ") || "No consistent out-of-sample improvement", stage: "OUT_OF_SAMPLE" }], note: `Source snapshot ${test.sourceSnapshotId}; target snapshot ${test.targetSnapshotId}; ${test.sampleSize} leakage-safe observations.` };
  }) });
});

research.get("/runs/:id", (req, res) => {
  const test = qarau.store.state.tests.find((item) => item.id === req.params.id);
  const run = test ? { id: test.id, target: test.target, horizon: `${test.horizon}D`, date: test.createdAt } : null;
  if (!run) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(run);
});

/**
 * The individual hypotheses behind a run's funnel diagram — a readable sample,
 * not the full population. Each lane names the dataset it came from and the
 * stage that killed it.
 */
research.get("/runs/:id/lanes", (req, res) => {
  const test = qarau.store.state.tests.find((item) => item.id === req.params.id);
  if (!test) { res.json({ runId: req.params.id, target: "", stageLabels: [], stageCounts: [], sampled: 0, tested: 0, lanes: [] }); return; }
  const source = qarau.store.state.sources.find((item) => item.id === test.sourceId);
  const passed = test.deltaR2 > 0;
  res.json({ runId: test.id, target: test.target, stageLabels: ["DATA", "LAGS", "ROBUSTNESS", "OOS"], stageCounts: [1, test.correlationByLag.length, test.stabilityAcrossFolds >= .5 ? 1 : 0, passed ? 1 : 0], sampled: 1, tested: test.correlationByLag.length, lanes: [{ id: test.id, rank: 1, survived: passed, diedAt: passed ? null : 3, diedAtLabel: passed ? null : "OOS", reachedStage: passed ? 4 : 3, signalId: passed ? test.id : null, ic: test.crossCorrelation, lag: test.bestLag, stability: test.stabilityAcrossFolds * 100, reason: passed ? null : test.warnings.join(", "), seed: 0, dataset: source ? { id: test.sourceSnapshotId, name: source.name, category: source.category, sourceType: source.sourceType, region: source.region, frequency: source.temporalResolution, historyYears: source.historicalDepth, quality: source.scores.quality, coverage: "historical" } : null }] });
});

function sourceMatchesUniverse(source, universe) {
  if (universe === "WEATHER") return source.category === "Weather";
  if (universe === "PORTS + LOGISTICS") return ["Logistics", "Mobility", "Water"].includes(source.category);
  if (universe === "ENERGY + INDUSTRY") return ["Energy", "Commodity infrastructure", "Pollution"].includes(source.category);
  return true;
}

research.post("/discovery/run", async (req, res) => {
  const target = String(req.body?.target ?? "EURUSD").toUpperCase();
  const horizon = String(req.body?.horizon ?? "3D");
  const universe = String(req.body?.universe ?? "ALL AVAILABLE").toUpperCase();
  const discovery = await qarau.discover({ providers: req.body?.providers });
  const activeSources = qarau.store.state.sources.filter((source) => source.status !== "ARCHIVED");
  const sources = activeSources.filter((source) => sourceMatchesUniverse(source, universe));
  const sourceIds = new Set(sources.map((source) => source.id));
  const horizonDays = Number.parseInt(horizon, 10);
  const tests = qarau.store.state.tests.filter((test) => test.target === target && test.horizon === horizonDays && sourceIds.has(test.sourceId));
  const passedOos = tests.filter((test) => test.deltaR2 > 0 && test.folds.filter((fold) => fold.deltaR2 > 0).length >= 2);
  const candidates = passedOos.filter((test) => test.evidenceScore >= 45);
  const snapshotsReady = sources.filter((source) => source.dataset).length;
  const featuresReady = sources.reduce((total, source) => total + (source.dataset?.provenance?.featureColumns?.length ?? 0), 0);
  const rejected = tests.filter((test) => !candidates.includes(test)).map((test) => {
    const source = sources.find((item) => item.id === test.sourceId);
    return {
      name: source?.name ?? "Source test",
      reason: test.warnings.join(", ") || "No consistent out-of-sample improvement",
      stage: test.deltaR2 > 0 ? "EVIDENCE_THRESHOLD" : "OUT_OF_SAMPLE",
    };
  });
  const requestedAt = new Date().toISOString();
  res.json({
    run: {
      id: discovery.job.id,
      target,
      horizon,
      universe,
      date: requestedAt,
      status: "COMPLETE",
      funnel: {
        datasets: sources.length,
        features: featuresReady,
        tested: tests.length,
        passedFilters: tests.filter((test) => test.sampleSize >= 48).length,
        passedRobustness: tests.filter((test) => test.stabilityAcrossFolds >= 0.5).length,
        passedOOS: passedOos.length,
        candidates: candidates.length,
      },
      catalog: {
        newSources: discovery.discovered,
        totalRegistry: activeSources.length,
        sourcesInScope: sources.length,
        snapshotsReady,
        featuresReady,
        matchingTests: tests.length,
      },
      producedSignalIds: candidates.map((test) => test.id),
      survivors: candidates.length,
      rejected,
      requestedAt,
      note: tests.length
        ? `${tests.length} real test${tests.length === 1 ? "" : "s"} matched ${target} / ${horizon} in ${universe}.`
        : `No completed tests match ${target} / ${horizon} in ${universe}.`,
    },
    discovery,
  });
});

app.use("/api/research", research);

const qarauApi = express.Router();
qarauApi.use(requireOwner);
qarauApi.use(requireCsrf);

function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const status = /not_found/.test(error.message) ? 404 : /devnet_signer_needs_funding|devnet_confirmation_timeout|devnet_transaction_failed/.test(error.message) ? 503 : /unsafe|invalid|insufficient|disabled|unsupported|required|unavailable|unknown|verification/.test(error.message) ? 400 : 500;
      res.status(status).json({ error: status === 500 ? "operation_failed" : error.message });
    }
  };
}

qarauApi.get("/sources", (req, res) => res.json(qarau.list(req.query)));
qarauApi.post("/sources/discover", operationLimit("discovery", 20, 60 * 60_000), route(async (req, res) => res.json(await qarau.discover(req.body ?? {}))));
qarauApi.post("/sources/manual", operationLimit("manual-source", 30, 60 * 60_000), route(async (req, res) => {
  const source = await qarau.createSource(req.body ?? {});
  await qarau.persist();
  res.status(201).json({ source: qarau.view(source) });
}));
qarauApi.get("/sources/:id", (req, res) => {
  const source = qarau.get(req.params.id);
  if (!source) return res.status(404).json({ error: "not_found" });
  const tests = qarau.store.state.tests.filter((test) => test.sourceId === source.id);
  const relatedIds = new Set([source.id, ...tests.map((test) => test.id)]);
  res.json({ source: qarau.view(source), privateMetadata: { summary: source.private.summary, url: source.private.url }, analysis: source.analysis, tests, commitments: qarau.store.state.commitments.filter((commitment) => relatedIds.has(commitment.resourceId)), claims: qarau.store.state.claims.filter((claim) => claim.sourceId === source.id), accessReceipts: qarau.store.state.accessReceipts.filter((receipt) => receipt.sourceId === source.id).map(({ salt: _salt, ...receipt }) => receipt) });
});
qarauApi.post("/sources/:id/parse", operationLimit("parse", 12, 60 * 60_000), route(async (req, res) => { const source = qarau.get(req.params.id); if (!source) throw new Error("not_found"); const job = await qarau.enqueue("PARSE_SOURCE", source.id, async () => { await qarau.parse(source); return { sourceId: source.id }; }); res.status(202).json({ job }); }));
qarauApi.post("/sources/:id/analyze", operationLimit("analyze", 12, 60 * 60_000), route(async (req, res) => { const source = qarau.get(req.params.id); if (!source) throw new Error("not_found"); const job = await qarau.enqueue("AI_ANALYZE_SOURCE", source.id, async () => { await qarau.analyze(source); return { sourceId: source.id }; }); res.status(202).json({ job }); }));
qarauApi.post("/sources/:id/connect", operationLimit("connect", 12, 60 * 60_000), route(async (req, res) => { const source = qarau.get(req.params.id); if (!source) throw new Error("not_found"); const job = await qarau.enqueue("INGEST_DATASET", source.id, async () => { const result = await qarau.connect(source); return { sourceId: source.id, snapshotId: result.dataset.snapshotId }; }); res.status(202).json({ job }); }));
qarauApi.post("/sources/:id/dataset", operationLimit("upload", 10, 60 * 60_000), route(async (req, res) => { const source = qarau.get(req.params.id); if (!source) throw new Error("not_found"); res.json(await qarau.ingest(source, req.body?.csv)); }));
qarauApi.post("/sources/:id/json-dataset", operationLimit("connect", 12, 60 * 60_000), route(async (req, res) => { const source = qarau.get(req.params.id); if (!source) throw new Error("not_found"); const input = req.body ?? {}; const job = await qarau.enqueue("INGEST_DATASET", source.id, async () => { const result = await qarau.ingestJson(source, input); return { sourceId: source.id, snapshotId: result.dataset.snapshotId }; }); res.status(202).json({ job }); }));
qarauApi.post("/sources/:id/test", operationLimit("alpha", 6, 60 * 60_000), route(async (req, res) => { const source = qarau.get(req.params.id); if (!source) throw new Error("not_found"); const input = req.body ?? {}; const job = await qarau.enqueue("RUN_ALPHA_TEST", source.id, async () => { const result = await qarau.test(source, input); return { sourceId: source.id, testId: result.test.id }; }); res.status(202).json({ job }); }));
qarauApi.post("/sources/:id/commit", operationLimit("queue-commitment", 30, 60 * 60_000), route(async (req, res) => { const source = qarau.get(req.params.id); if (!source) throw new Error("not_found"); res.status(202).json({ commitment: await qarau.queueCommit("SOURCE", source) }); }));
qarauApi.get("/alpha-tests/:id", (req, res) => { const test = qarau.store.state.tests.find((item) => item.id === req.params.id); if (!test) return res.status(404).json({ error: "not_found" }); res.json({ test }); });
qarauApi.post("/alpha-tests/:id/commit", operationLimit("queue-commitment", 30, 60 * 60_000), route(async (req, res) => { const test = qarau.store.state.tests.find((item) => item.id === req.params.id); if (!test) throw new Error("not_found"); res.status(202).json({ commitment: await qarau.queueCommit("ANALYSIS", test) }); }));
qarauApi.post("/commitments/epoch", operationLimit("solana", 4, 60 * 60_000), route(async (_req, res) => res.json(await qarau.commitEpoch({ immediate: true }))));
qarauApi.get("/commitments/schedule", (_req, res) => res.json(qarau.commitmentSchedule()));
qarauApi.get("/solana/transactions/:id", (req, res) => { const transaction = qarau.transaction(req.params.id); if (!transaction) return res.status(404).json({ error: "not_found" }); res.json({ transaction }); });
qarauApi.post("/sources/:id/claims", route(async (req, res) => { const source = qarau.get(req.params.id); if (!source) throw new Error("not_found"); const claim = qarau.beginVerification(source, req.body?.method); await qarau.persist(); res.status(201).json({ claim }); }));
qarauApi.post("/sources/:id/claims/:claimId/decision", route(async (req, res) => { const source = qarau.get(req.params.id); if (!source) throw new Error("not_found"); const claim = qarau.decideVerification(source, req.params.claimId, req.body?.decision); await qarau.persist(); res.json({ claim }); }));
qarauApi.post("/sources/:id/access-receipts", operationLimit("receipt", 30, 60 * 60_000), route(async (req, res) => { const source = qarau.get(req.params.id); if (!source) throw new Error("not_found"); const receipt = qarau.recordAccessReceipt(source, req.body?.purpose); await qarau.persist(); const { salt: _salt, ...safe } = receipt; res.status(201).json({ receipt: safe }); }));
qarauApi.get("/jobs/:id", (req, res) => { const job = qarau.store.state.jobs.find((item) => item.id === req.params.id); if (!job) return res.status(404).json({ error: "not_found" }); res.json({ job }); });
qarauApi.get("/filters/options", (_req, res) => res.json(qarau.options()));
app.use("/api/qarau", qarauApi);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "not_found" });
});

// In production the built SPA is served from the same origin, which keeps the
// session cookie first-party and lets sameSite=strict do its job.
const dist = join(here, "..", "dist");
app.use(express.static(dist, { index: false, maxAge: "1h" }));
app.get(/.*/, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(join(dist, "index.html"), (err) => {
    if (err) res.status(404).end();
  });
});

const owner = await initOwner();
qarau.startScheduler();
app.listen(PORT, () => {
  const lines = [
    "",
    "  QARAU / INTERNAL",
    `  research api    http://localhost:${PORT}/api`,
    `  owner           ${owner.ownerId}`,
    `  environment     ${process.env.NODE_ENV ?? "development"}`,
  ];
  const generated = authBanner();
  if (generated) {
    lines.push(
      "",
      "  No OWNER_PASSWORD_HASH configured, so a password was generated",
      "  for this process only. It changes on every restart.",
      "",
      `  owner password  ${generated}`,
      "",
      "  To set a permanent one:  npm run auth:hash -- 'your-password'",
    );
  }
  lines.push("");
  console.log(lines.join("\n"));
});

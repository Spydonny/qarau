import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { authBanner, initOwner, registerAuthRoutes, requireOwner } from "./auth.mjs";
import {
  GAPS,
  SIGNALS,
  datasetViews,
  inventoryStats,
  runLanes,
  runViews,
  signalDetail,
  signalSummaries,
} from "./data/research.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// Deliberately API_PORT rather than PORT: dev tooling routinely sets PORT for
// the web server, and inheriting it makes the API try to bind Vite's port.
// Both then land on the same port and the built index.html gets served over
// the dev server, which fails in a thoroughly confusing way.
const PORT = Number(process.env.API_PORT ?? 8787);

const app = express();
app.disable("x-powered-by");
// Behind a proxy the client address is needed for login throttling.
app.set("trust proxy", 1);
app.use(express.json({ limit: "16kb" }));

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  // Nothing here should ever be cached by an intermediary.
  res.setHeader("Cache-Control", "no-store");
  next();
});

registerAuthRoutes(app);

/* ============================================================
   RESEARCH ROUTES
   Every one is behind requireOwner. The router is mounted as a
   whole so a new endpoint cannot be added unprotected by
   forgetting the middleware on an individual route.
   ============================================================ */

const research = express.Router();
research.use(requireOwner);

/**
 * Which targets and universes the engine will accept.
 *
 * Served rather than hardcoded in the client on purpose: the list of assets
 * under research is itself sensitive, and anything compiled into the bundle
 * is readable by anyone who can fetch the page.
 */
research.get("/config", (_req, res) => {
  res.json({
    targets: [...new Set(SIGNALS.map((s) => s.target))],
    universes: ["ALL AVAILABLE", "ENERGY + INDUSTRY", "PORTS + LOGISTICS", "WEATHER"],
    horizons: ["1D", "3D", "7D", "14D"],
  });
});

research.get("/signals", (_req, res) => {
  res.json({ stats: inventoryStats(), signals: signalSummaries() });
});

research.get("/signals/:id", (req, res) => {
  const detail = signalDetail(req.params.id);
  if (!detail) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(detail);
});

research.get("/datasets", (_req, res) => {
  res.json({ datasets: datasetViews() });
});

research.get("/gaps", (_req, res) => {
  // internalNote is the reason we want the measurement, so it stays here and
  // is never part of an outward-facing request.
  res.json({ gaps: GAPS });
});

research.get("/runs", (_req, res) => {
  res.json({ runs: runViews() });
});

research.get("/runs/:id", (req, res) => {
  const run = runViews().find((r) => r.id === req.params.id);
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
  const lanes = runLanes(req.params.id);
  if (!lanes) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(lanes);
});

/**
 * Starting a discovery run. The funnel is served from the run log rather than
 * computed, since there is no engine behind this yet — the shape of the
 * response is what a real engine would return.
 */
research.post("/discovery/run", (req, res) => {
  const target = String(req.body?.target ?? "").toUpperCase();
  const horizon = String(req.body?.horizon ?? "3D");
  const runs = runViews();
  const match = runs.find((r) => r.target === target && r.horizon === horizon)
    ?? runs.find((r) => r.target === target)
    ?? runs[0];

  res.json({
    run: {
      ...match,
      id: match.id,
      target: target || match.target,
      horizon,
      requestedAt: new Date().toISOString(),
    },
  });
});

app.use("/api/research", research);

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

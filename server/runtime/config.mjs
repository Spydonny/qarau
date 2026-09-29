import { z } from "zod";

export const SERVICE_ROLES = Object.freeze([
  "api",
  "worker-discovery",
  "worker-scrape",
  "worker-analysis",
  "worker-chain",
  "scheduler",
  "publisher-signer",
]);

const privateUrl = z.string().url();
const nonempty = z.string().min(1);
const positivePort = z.coerce.number().int().min(1).max(65_535);
const secret = z.string().min(16);

const requiredByRole = Object.freeze({
  api: ["MONGODB_URI", "SOURCE_URL_ENCRYPTION_KEY", "WALLET_SESSION_SECRET", "SOLANA_RPC_URL", "SOLANA_PROGRAM_ID"],
  "worker-discovery": ["MONGODB_URI", "SOURCE_URL_ENCRYPTION_KEY"],
  "worker-scrape": ["MONGODB_URI", "SOURCE_URL_ENCRYPTION_KEY"],
  "worker-analysis": ["MONGODB_URI"],
  "worker-chain": ["MONGODB_URI", "SOLANA_RPC_URL", "SOLANA_PROGRAM_ID", "PUBLISHER_SIGNER_URL", "PUBLISHER_SIGNER_TOKEN"],
  scheduler: ["MONGODB_URI"],
  "publisher-signer": ["SOLANA_RPC_URL", "SOLANA_PROGRAM_ID", "PUBLISHER_SIGNER_TOKEN", "SOLANA_PUBLISHER_KEY_PATH"],
});

const validators = Object.freeze({
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\/.+/, "MONGODB_URI must be a mongodb:// or mongodb+srv:// Atlas connection string"),
  MONGODB_DB: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  S3_ENDPOINT: privateUrl,
  S3_REGION: nonempty,
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  S3_ACCESS_KEY_ID: nonempty,
  S3_SECRET_ACCESS_KEY: z.string().min(8),
  SOURCE_URL_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  WALLET_SESSION_SECRET: z.string().min(32),
  SOLANA_RPC_URL: privateUrl.refine((value) => { try { const host = new URL(value).hostname.toLowerCase(); if (host === "api.devnet.solana.com" || host.endsWith(".devnet.solana.com") || host === "localhost" || host === "127.0.0.1" || host === "::1") return true; } catch {} return false; }, "MVP supports only Devnet or local validator RPC"),
  SOLANA_PROGRAM_ID: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  PUBLISHER_SIGNER_URL: privateUrl,
  PUBLISHER_SIGNER_TOKEN: secret,
  SOLANA_PUBLISHER_KEY_PATH: z.string().startsWith("/"),
});

function parseRole(role) {
  if (!SERVICE_ROLES.includes(role)) throw new Error(`unknown_service_role:${role}`);
  return role;
}

export function loadServiceConfig(role, environment = process.env) {
  const serviceRole = parseRole(role);
  const runtimeMode = z.enum(["legacy", "integrated"]).parse(environment.QARAU_RUNTIME_MODE ?? "legacy");
  const artifactStore = z.enum(["s3", "mongodb"]).parse(environment.ARTIFACT_STORE ?? "s3");
  if (serviceRole !== "publisher-signer" && environment.SOLANA_PUBLISHER_KEY_PATH) {
    throw new Error(`publisher_key_forbidden_for_role:${serviceRole}`);
  }

  const values = {};
  if (runtimeMode === "integrated" || serviceRole !== "api") {
    for (const name of requiredByRole[serviceRole]) values[name] = validators[name].parse(environment[name]);
    if (artifactStore === "s3" && ["api", "worker-scrape", "worker-analysis", "worker-chain"].includes(serviceRole)) {
      for (const name of ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) values[name] = validators[name].parse(environment[name]);
    }
  }

  const defaultPort = serviceRole === "api" ? 8787 : 8790 + SERVICE_ROLES.indexOf(serviceRole);
  const healthPort = positivePort.parse(environment.SERVICE_HEALTH_PORT ?? environment.API_PORT ?? defaultPort);
  return Object.freeze({ role: serviceRole, runtimeMode, artifactStore, healthPort, executeJobs: environment.QARAU_WORKER_EXECUTE === "true", values: Object.freeze(values) });
}

export function publicRuntimeSummary(config) {
  return Object.freeze({
    role: config.role,
    mode: config.runtimeMode,
    persistence: config.runtimeMode === "integrated" ? config.artifactStore === "mongodb" ? "mongodb-private-artifacts" : "mongodb-atlas-and-private-object-store" : "encrypted-local-migration-mode",
    capabilities: config.role === "api" ? "prototype-compatible" : config.executeJobs ? "worker-execution-active" : "foundation-only",
  });
}

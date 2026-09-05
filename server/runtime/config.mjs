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
  api: ["DATABASE_URL", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "WALLET_SESSION_SECRET", "SOLANA_RPC_URL", "SOLANA_PROGRAM_ID"],
  "worker-discovery": ["DATABASE_URL"],
  "worker-scrape": ["DATABASE_URL", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "SOURCE_URL_ENCRYPTION_KEY"],
  "worker-analysis": ["DATABASE_URL", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
  "worker-chain": ["DATABASE_URL", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "SOLANA_RPC_URL", "SOLANA_PROGRAM_ID", "PUBLISHER_SIGNER_URL", "PUBLISHER_SIGNER_TOKEN"],
  scheduler: ["DATABASE_URL"],
  "publisher-signer": ["SOLANA_RPC_URL", "SOLANA_PROGRAM_ID", "PUBLISHER_SIGNER_TOKEN", "SOLANA_PUBLISHER_KEY_PATH"],
});

const validators = Object.freeze({
  DATABASE_URL: privateUrl,
  S3_ENDPOINT: privateUrl,
  S3_REGION: nonempty,
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  S3_ACCESS_KEY_ID: nonempty,
  S3_SECRET_ACCESS_KEY: z.string().min(8),
  SOURCE_URL_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  WALLET_SESSION_SECRET: z.string().min(32),
  SOLANA_RPC_URL: privateUrl.refine((value) => /devnet|127\.0\.0\.1|localhost/i.test(value), "MVP supports only Devnet or local validator RPC"),
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
  if (serviceRole !== "publisher-signer" && environment.SOLANA_PUBLISHER_KEY_PATH) {
    throw new Error(`publisher_key_forbidden_for_role:${serviceRole}`);
  }

  const values = {};
  if (runtimeMode === "integrated" || serviceRole !== "api") {
    for (const name of requiredByRole[serviceRole]) values[name] = validators[name].parse(environment[name]);
  }

  const defaultPort = serviceRole === "api" ? 8787 : 8790 + SERVICE_ROLES.indexOf(serviceRole);
  const healthPort = positivePort.parse(environment.SERVICE_HEALTH_PORT ?? environment.API_PORT ?? defaultPort);
  return Object.freeze({ role: serviceRole, runtimeMode, healthPort, values: Object.freeze(values) });
}

export function publicRuntimeSummary(config) {
  return Object.freeze({
    role: config.role,
    mode: config.runtimeMode,
    persistence: config.runtimeMode === "integrated" ? "postgresql-and-private-object-store" : "encrypted-local-migration-mode",
    capabilities: config.role === "api" ? "prototype-compatible" : "foundation-only",
  });
}

import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../domain/canonical-artifacts.mjs";

const uuid = z.string().uuid();
const nonempty = z.string().min(1).max(256);

export const JOB_PAYLOADS = Object.freeze({
  "discovery.run": Object.freeze({ role: "worker-discovery", version: 1, schema: z.object({ queryGroup: nonempty, requestedBy: uuid.nullable(), requestId: uuid }).strict() }),
  "scrape.source": Object.freeze({ role: "worker-scrape", version: 1, schema: z.object({ sourceId: uuid, reason: z.enum(["scheduled", "manual", "retry"]), scheduledFor: z.string().datetime() }).strict() }),
  "analysis.run": Object.freeze({ role: "worker-analysis", version: 1, schema: z.object({ analysisRunId: uuid }).strict() }),
  "chain.publish": Object.freeze({ role: "worker-chain", version: 1, schema: z.object({ packageId: uuid, startsAt: z.string().datetime(), endsAt: z.string().datetime(), earlyPriceLamports: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), delayedPriceLamports: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict() }),
  "chain.reconcile": Object.freeze({ role: "worker-chain", version: 1, schema: z.object({ network: z.enum(["localnet", "devnet"]), account: nonempty }).strict() }),
  "schedule.due-sources": Object.freeze({ role: "scheduler", version: 1, schema: z.object({ asOf: z.string().datetime() }).strict() }),
});

export function parseJobPayload(type, payloadVersion, payload) {
  const definition = JOB_PAYLOADS[type];
  if (!definition) throw new Error("unknown_job_type");
  if (payloadVersion !== definition.version) throw new Error("unsupported_job_payload_version");
  return definition.schema.parse(payload);
}

export function jobTypesForRole(role) {
  return Object.freeze(Object.entries(JOB_PAYLOADS).filter(([, definition]) => definition.role === role).map(([type]) => type));
}

export function jobIdempotencyKey(type, payloadVersion, payload) {
  const parsed = parseJobPayload(type, payloadVersion, payload);
  const digest = createHash("sha256").update(`${type}\0${payloadVersion}\0${canonicalJson(parsed)}`, "utf8").digest("hex");
  return `job:v${payloadVersion}:${type}:${digest}`;
}

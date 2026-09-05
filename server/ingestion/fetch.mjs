import { randomUUID } from "node:crypto";
import { HASH_DOMAINS, hashBytes } from "../domain/canonical-artifacts.mjs";
import { requestExternalBytes } from "../lib/url-policy.mjs";

function assertUuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value))) throw new Error(`invalid_${label}`);
  return String(value).toLowerCase();
}

/** Captures source bytes before any parsing or normalization occurs. */
export async function captureRawSnapshot({ sourceId, snapshotId = randomUUID(), url, artifactStore, requestBytes = requestExternalBytes, maxBytes = 8_000_000 }) {
  const source = assertUuid(sourceId, "source_id");
  const snapshot = assertUuid(snapshotId, "snapshot_id");
  if (!artifactStore || typeof artifactStore.putOnce !== "function") throw new Error("artifact_store_required");
  const response = await requestBytes(url, { maxBytes, timeoutMs: 20_000 });
  if (!Buffer.isBuffer(response.bytes) || response.bytes.length === 0 || response.bytes.length > maxBytes) throw new Error("invalid_source_response_bytes");
  const rawHash = hashBytes(HASH_DOMAINS.rawSnapshot, response.bytes);
  const key = `raw/${source}/${snapshot}/response-body.bin`;
  await artifactStore.putOnce({ key, bytes: response.bytes, artifactHash: rawHash, contentType: response.contentType || "application/octet-stream" });
  return Object.freeze({
    sourceId: source,
    snapshotId: snapshot,
    rawObjectKey: key,
    rawHash,
    contentLength: response.bytes.length,
    contentType: response.contentType || "application/octet-stream",
    responseHeaders: response.headers ?? {},
    retrievedAt: new Date().toISOString(),
    resolvedUrl: response.url,
  });
}

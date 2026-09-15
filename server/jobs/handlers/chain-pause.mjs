import { callPublisherSigner, publisherSignerError } from "../publisher-signer.mjs";

/** Pulls the on-chain kill-switch through the isolated publisher signer. */
export function createChainPauseHandler({ pool, publisherSignerUrl, publisherSignerToken, fetchImpl = fetch }) {
  if (!pool || !publisherSignerUrl || !publisherSignerToken) throw new Error("chain_pause_dependencies_required");
  return async function pause(job) {
    const { paused, requestedBy } = job.payload;
    const { ok, payload } = await callPublisherSigner({ url: publisherSignerUrl, token: publisherSignerToken, action: "pause", body: { paused }, fetchImpl });
    // The audit row is the operator-visible record of a privileged control, so it
    // is written for a refused switch as well as an applied one.
    await pool.query("INSERT INTO audit_events (actor_type, actor_id, action, resource_type, resource_id, request_id, outcome, metadata) VALUES ('owner', $1, $2, 'registry', $3, $4, $5, $6)", [requestedBy, paused ? "registry.pause" : "registry.unpause", payload?.registryPda ?? "unknown", job.id, ok ? "applied" : "failed", { paused, signature: payload?.transaction?.signature ?? null, slot: payload?.finalizedSlot ?? null, error: ok ? null : String(payload?.error ?? "publisher_signer_failed") }]);
    if (!ok) throw publisherSignerError(payload);
    return { paused, registryPda: payload.registryPda, signature: payload.transaction?.signature ?? null, finalizedSlot: payload.finalizedSlot ?? null };
  };
}

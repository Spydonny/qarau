/** Pulls the on-chain kill-switch through the isolated publisher signer. */
export function createChainPauseHandler({ pool, publisherSignerUrl, publisherSignerToken, fetchImpl = fetch }) {
  if (!pool || !publisherSignerUrl || !publisherSignerToken) throw new Error("chain_pause_dependencies_required");
  return async function pause(job) {
    const { paused, requestedBy } = job.payload;
    const response = await fetchImpl(`${publisherSignerUrl.replace(/\/$/, "")}/pause`, { method: "POST", headers: { "content-type": "application/json", "x-publisher-token": publisherSignerToken }, body: JSON.stringify({ paused }), signal: AbortSignal.timeout(60_000) });
    const result = await response.json();
    // The audit row is the operator-visible record of a privileged control, so it
    // is written for a refused switch as well as an applied one.
    await pool.query("INSERT INTO audit_events (actor_type, actor_id, action, resource_type, resource_id, request_id, outcome, metadata) VALUES ('owner', $1, $2, 'registry', $3, $4, $5, $6)", [requestedBy, paused ? "registry.pause" : "registry.unpause", result?.registryPda ?? "unknown", job.id, response.ok ? "applied" : "failed", { paused, signature: result?.transaction?.signature ?? null, slot: result?.finalizedSlot ?? null, error: response.ok ? null : String(result?.error ?? "publisher_signer_failed") }]);
    if (!response.ok) throw new Error(result?.error ?? "publisher_signer_failed");
    return { paused, registryPda: result.registryPda, signature: result.transaction?.signature ?? null, finalizedSlot: result.finalizedSlot ?? null };
  };
}

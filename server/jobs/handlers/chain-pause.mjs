import { createRepositories } from "../../db/repositories/index.mjs";
import { callPublisherSigner, publisherSignerError } from "../publisher-signer.mjs";

/** Pulls the on-chain kill-switch through the isolated publisher signer. */
export function createChainPauseHandler({ db, publisherSignerUrl, publisherSignerToken, fetchImpl = fetch }) {
  if (!db || !publisherSignerUrl || !publisherSignerToken) throw new Error("chain_pause_dependencies_required");
  const repositories = createRepositories(db);
  return async function pause(job) {
    const { paused, requestedBy } = job.payload;
    const { ok, payload } = await callPublisherSigner({ url: publisherSignerUrl, token: publisherSignerToken, action: "pause", body: { paused }, fetchImpl });
    // The audit row is the operator-visible record of a privileged control, so it
    // is written for a refused switch as well as an applied one.
    await repositories.audits.create({ actor_type: "owner", actor_id: requestedBy, action: paused ? "registry.pause" : "registry.unpause", resource_type: "registry", resource_id: payload?.registryPda ?? "unknown", request_id: job.id, outcome: ok ? "applied" : "failed", metadata: { paused, signature: payload?.transaction?.signature ?? null, slot: payload?.finalizedSlot ?? null, error: ok ? null : String(payload?.error ?? "publisher_signer_failed") } });
    if (!ok) throw publisherSignerError(payload);
    return { paused, registryPda: payload.registryPda, signature: payload.transaction?.signature ?? null, finalizedSlot: payload.finalizedSlot ?? null };
  };
}

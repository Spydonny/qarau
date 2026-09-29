import { jobIdempotencyKey } from "../jobs/payloads.mjs";

export const STALE_ROUNDS_QUERY = Object.freeze({
  description: "access_rounds with state in (upcoming,live,ended), finalized, last_reconciled_at null or older than staleSeconds, ordered nulls-first",
  collection: "access_rounds",
});

// Rounds are reconciled at most once per minute each: the payload carries the
// observation window so the idempotency key dedupes a tick without freezing the
// loop the way a constant key would.
function observationWindow(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid_schedule_time");
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

/** Enqueues chain reconciliation for rounds whose on-chain state may have drifted. */
export async function enqueueStaleRounds({ db, queue, now = new Date(), limit = 100, staleSeconds = 120 }) {
  if (!db || typeof db.collection !== "function" || !queue || typeof queue.enqueue !== "function") throw new Error("scheduler_dependencies_required");
  const observedFor = observationWindow(now);
  const cutoff = new Date(now.getTime() - staleSeconds * 1_000);
  const due = await db.collection("access_rounds").find({
    state: { $in: ["upcoming", "live", "ended"] },
    confirmation_status: "finalized",
    $or: [{ last_reconciled_at: null }, { last_reconciled_at: { $lt: cutoff } }],
  }).sort({ last_reconciled_at: 1 }).limit(limit).project({ round_pda: 1, network: 1 }).toArray();
  const jobs = [];
  for (const round of due) {
    const payload = { network: round.network, account: round.round_pda, observedFor };
    jobs.push(await queue.enqueue({ type: "chain.reconcile", payloadVersion: 2, payload, idempotencyKey: jobIdempotencyKey("chain.reconcile", 2, payload), resourceType: "access_round", resourceId: round._id }));
  }
  return Object.freeze({ observedFor, considered: due.length, enqueued: jobs.filter((entry) => entry.created).length, jobs: Object.freeze(jobs) });
}

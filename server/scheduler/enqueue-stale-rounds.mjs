import { jobIdempotencyKey } from "../jobs/payloads.mjs";

export const STALE_ROUNDS_QUERY = `SELECT id, round_pda, network FROM access_rounds
     WHERE state IN ('upcoming', 'live', 'ended')
       AND confirmation_status = 'finalized'
       AND (last_reconciled_at IS NULL OR last_reconciled_at < now() - make_interval(secs => $1::double precision))
     ORDER BY last_reconciled_at ASC NULLS FIRST
     LIMIT $2`;

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
export async function enqueueStaleRounds({ pool, queue, now = new Date(), limit = 100, staleSeconds = 120 }) {
  if (!pool || typeof pool.query !== "function" || !queue || typeof queue.enqueue !== "function") throw new Error("scheduler_dependencies_required");
  const observedFor = observationWindow(now);
  const due = await pool.query(STALE_ROUNDS_QUERY, [staleSeconds, limit]);
  const jobs = [];
  for (const round of due.rows) {
    const payload = { network: round.network, account: round.round_pda, observedFor };
    jobs.push(await queue.enqueue({ type: "chain.reconcile", payloadVersion: 2, payload, idempotencyKey: jobIdempotencyKey("chain.reconcile", 2, payload), resourceType: "access_round", resourceId: round.id }));
  }
  return Object.freeze({ observedFor, considered: due.rows.length, enqueued: jobs.filter((entry) => entry.created).length, jobs: Object.freeze(jobs) });
}

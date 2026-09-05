export function validateIntent(intent) {
  if (!intent || typeof intent !== "object" || Array.isArray(intent) || Object.keys(intent).sort().join(",") !== "action,epoch,root,version") throw new Error("invalid_intent_shape");
  if (intent.action !== "COMMIT_MERKLE_ROOT" || intent.version !== 1) throw new Error("intent_not_allowed");
  if (!/^[a-f0-9]{64}$/.test(intent.root) || !/^\d{10}$/.test(intent.epoch)) throw new Error("invalid_commitment_intent");
  return intent;
}

export function enforceDailyLimit(entries, day, limit = 24) {
  if (!Array.isArray(entries) || entries.filter((entry) => entry.day === day).length >= limit) throw new Error("signer_daily_limit_reached");
}

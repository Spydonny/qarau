const TEMPORAL_STATES = new Set(["upcoming", "live", "ended"]);
const TERMINAL_STATES = new Set(["settled", "access_granted", "expired"]);

function milliseconds(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return Date.parse(value);
}

/**
 * Returns the state implied by an access round's window at read time.
 * Terminal lifecycle states are authoritative and must never be rewound.
 */
export function effectiveAccessRoundState(round, now = Date.now()) {
  const storedState = round?.round_state ?? round?.state;
  if (TERMINAL_STATES.has(storedState) || !TEMPORAL_STATES.has(storedState)) return storedState;

  const opensAt = milliseconds(round?.opens_at ?? round?.opensAt);
  const closesAt = milliseconds(round?.closes_at ?? round?.closesAt);
  const currentTime = milliseconds(now);
  if (![opensAt, closesAt, currentTime].every(Number.isFinite) || closesAt <= opensAt) return storedState;
  if (currentTime < opensAt) return "upcoming";
  if (currentTime <= closesAt) return "live";
  return "ended";
}

export function hasTemporalAccessRoundState(round) {
  return TEMPORAL_STATES.has(round?.round_state ?? round?.state);
}

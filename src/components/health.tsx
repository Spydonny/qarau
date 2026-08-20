import type { Crowding, SignalStatus } from "../api/types";

/* ============================================================
   SIGNAL HEALTH

   Colour appears only where it is a verdict: a signal earning
   its allocation, or one falling apart. Everything else stays
   grayscale, so the few coloured marks are actually readable.
   ============================================================ */

/** Which signals count as working research versus failing research. */
const TONE: Record<SignalStatus, "pos" | "neg" | "none"> = {
  ACTIVE: "pos",
  CANDIDATE: "pos",
  WATCHLIST: "none",
  DEGRADING: "neg",
  RETIRED: "neg",
  REJECTED: "neg",
};

/** Lifecycle marker. Filled square = allocated, hollow = held back. */
export function StatusMark({ status }: { status: SignalStatus }) {
  const tone = TONE[status];
  const filled = status === "ACTIVE";
  const faded = status === "RETIRED" || status === "REJECTED";
  return (
    <span className={`status ${tone !== "none" ? tone : ""} ${faded ? "is-faded" : ""}`}>
      <span className={`status-glyph ${filled ? "is-filled" : ""}`} aria-hidden="true" />
      {status}
    </span>
  );
}

/**
 * A 0-100 measure as a rule with a filled portion.
 *
 * `invert` marks metrics where high is bad (decay). Those are drawn in the
 * negative tone once they pass the point where the signal is in trouble,
 * rather than being red at every value — a decay of 8 is not a warning.
 */
export function HealthBar({
  label,
  value,
  invert = false,
}: {
  label: string;
  value: number;
  invert?: boolean;
}) {
  const alarming = invert ? value >= 50 : value < 50;
  return (
    <div className="hb">
      <span className="meta hb-label">{label}</span>
      <span className="hb-track">
        <span
          className={`hb-fill ${alarming ? "is-alarm" : invert ? "is-invert" : ""}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </span>
      <span className={`mono hb-value ${alarming ? "neg" : ""}`}>{value}</span>
    </div>
  );
}

/** Crowding is a heuristic, and the interface says so rather than implying measurement. */
export function CrowdingMark({ level }: { level: Crowding }) {
  const filled = level === "HIGH" ? 3 : level === "MODERATE" ? 2 : 1;
  return (
    <span className={`strength ${level === "HIGH" ? "is-neg" : ""}`} aria-label={`${level} (heuristic)`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={`strength-bar ${i < filled ? "is-on" : ""}`} />
      ))}
    </span>
  );
}

/**
 * A verdict: did this survive or not.
 * The single most important piece of colour in the product — true alpha
 * against false alpha.
 */
export function Verdict({
  passed,
  children,
}: {
  passed: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`val ${passed ? "pos" : "neg"}`}>
      <span className={`val-mark ${passed ? "" : "is-hollow"}`} aria-hidden="true" />
      {children}
    </span>
  );
}

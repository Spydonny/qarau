import { useWidth } from "./useWidth";
import { INK } from "./charts";

/* ============================================================
   RELATIONSHIP DIAGRAM

   The product's core claim in one figure: an observation on the
   upper rail, the market on the lower one, and the measured lead
   as the vertical distance between them.

   Three states, carried by the lines themselves rather than by
   any badge:
     validated — both rails continuous, joined
     rejected  — the link terminates in ×
     missing   — the observation rail is dotted and never arrives
   ============================================================ */

type Props = {
  state?: "validated" | "rejected" | "missing";
  lag?: number;
  /** Upper rail caption. */
  source?: string;
  /** Lower rail caption. */
  target?: string;
  height?: number;
};

export function Relationship({
  state = "validated",
  lag = 2,
  source = "DATA",
  target = "MARKET",
  height = 150,
}: Props) {
  const [ref, w] = useWidth<HTMLDivElement>();
  if (w === 0) return <div ref={ref} style={{ height }} />;

  const topY = 40;
  const botY = height - 34;
  const nodeX = w * 0.46;
  const label = (t: string) => t.toUpperCase();

  const missing = state === "missing";
  const rejected = state === "rejected";

  return (
    <div ref={ref} className="rel">
      <svg width={w} height={height} style={{ display: "block", overflow: "visible" }}>
        <text x={0} y={topY - 14} fill="#666666" fontSize={10} letterSpacing="0.16em"
          fontFamily="var(--font-mono)">
          {label(source)}
        </text>

        {/* Upper rail. Dotted throughout when the observation does not exist. */}
        {missing ? (
          <line x1={0} x2={w} y1={topY} y2={topY} stroke="#FFFFFF" strokeWidth={1}
            strokeDasharray="1 5" opacity={0.35} />
        ) : (
          <>
            <line x1={0} x2={w} y1={topY} y2={topY} stroke="#FFFFFF" strokeWidth={1} opacity={0.5} />
            <circle cx={nodeX} cy={topY} r={3.4} fill={rejected ? INK.neg : INK.pos} />
            <circle cx={nodeX} cy={topY} r={9} fill="none"
              stroke={rejected ? INK.neg : INK.pos} opacity={0.28} />
          </>
        )}

        {missing && (
          <text x={0} y={topY + 20} fill="#4A4A4A" fontSize={9.5} letterSpacing="0.1em"
            fontFamily="var(--font-mono)">
            NO OBSERVATION AVAILABLE
          </text>
        )}

        {/* The lead: vertical distance from observation to market response. */}
        {!missing && (
          <>
            <line
              x1={nodeX}
              x2={nodeX}
              y1={topY + 10}
              y2={rejected ? (topY + botY) / 2 : botY - 10}
              stroke="#FFFFFF"
              strokeWidth={1}
              opacity={rejected ? 0.2 : 0.35}
              strokeDasharray="2 4"
            />
            <text x={nodeX + 13} y={(topY + botY) / 2 - 2} fill={rejected ? INK.neg : INK.primary}
              fontSize={10} letterSpacing="0.14em" fontFamily="var(--font-mono)">
              {rejected ? "NOT VALIDATED" : `-${lag}D`}
            </text>
            {!rejected && (
              <path
                d={`M${nodeX - 4} ${botY - 16} L${nodeX} ${botY - 10} L${nodeX + 4} ${botY - 16}`}
                fill="none" stroke="#FFFFFF" strokeWidth={1} opacity={0.6}
              />
            )}
            {rejected && (
              <text x={nodeX - 5} y={(topY + botY) / 2 + 12} fill={INK.neg} fontSize={13}
                fontFamily="var(--font-mono)">
                ×
              </text>
            )}
          </>
        )}

        <text x={0} y={botY - 14} fill="#666666" fontSize={10} letterSpacing="0.16em"
          fontFamily="var(--font-mono)">
          {label(target)}
        </text>
        <line x1={0} x2={w} y1={botY} y2={botY} stroke="#8A8A8A" strokeWidth={1} opacity={0.5} />
        {!missing && !rejected && <circle cx={nodeX} cy={botY} r={3} fill={INK.pos} opacity={0.75} />}
      </svg>
    </div>
  );
}

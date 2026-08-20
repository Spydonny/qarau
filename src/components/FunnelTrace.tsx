import { useState } from "react";
import { useWidth } from "./useWidth";
import { INK } from "./charts";
import type { Lane, RunLanes } from "../api/types";

/* ============================================================
   FUNNEL TRACE

   The shape of the method: many hypotheses enter on the left,
   the great majority terminate in ×, a very small number reach
   the end. Meant to look skeptical rather than magical.

   Every lane is a real hypothesis — a dataset paired with the
   target — so hovering one reports the instrument behind it and
   clicking opens its full record.
   ============================================================ */

type Props = {
  data: RunLanes | null;
  /** 0 → 1 across the run. */
  progress: number;
  selectedId: string | null;
  onSelect: (lane: Lane) => void;
};

export function FunnelTrace({ data, progress, selectedId, onSelect }: Props) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<Lane | null>(null);

  const height = 320;
  if (w === 0 || !data) return <div ref={ref} style={{ height }} />;

  const left = 8;
  const right = w - 8;
  const span = right - left;
  const laneTop = 30;
  const laneBottom = height - 58;
  const stages = data.stageLabels;
  const n = data.lanes.length;

  /** Fraction of the width at which a stage sits. */
  const stageX = (s: number) => left + (span * s) / (stages.length - 1);
  const laneY = (i: number) => laneTop + (i / Math.max(n - 1, 1)) * (laneBottom - laneTop);

  return (
    <div ref={ref} className="funnel-trace">
      <svg
        width={w}
        height={height}
        style={{ display: "block", overflow: "visible" }}
        onMouseLeave={() => setHover(null)}
      >
        {stages.map((label, si) => {
          const x = stageX(si);
          const lit = progress >= si / (stages.length - 1);
          const anchor = si === stages.length - 1 ? "end" : "start";
          return (
            <g key={label}>
              <line
                x1={x}
                x2={x}
                y1={laneTop - 12}
                y2={laneBottom + 8}
                stroke={lit ? INK.axis : "#111214"}
                shapeRendering="crispEdges"
              />
              <text
                x={x}
                y={laneBottom + 26}
                fill={lit ? INK.mid : "#3A3B40"}
                fontSize={9}
                letterSpacing="0.12em"
                fontFamily="var(--font-mono)"
                textAnchor={anchor}
                style={{ transition: "fill 400ms" }}
              >
                {label}
              </text>
              <text
                x={x}
                y={laneTop - 20}
                fill={lit ? INK.primary : "#3A3B40"}
                fontSize={10}
                letterSpacing="0.1em"
                fontFamily="var(--font-mono)"
                textAnchor={anchor}
                style={{ transition: "fill 400ms" }}
              >
                {data.stageCounts[si]}
              </text>
            </g>
          );
        })}

        {data.lanes.map((lane, i) => {
          const y = laneY(i);
          const endStage = lane.reachedStage;
          const endAt = endStage / (stages.length - 1);
          const drawn = Math.min(progress, endAt);
          const x2 = left + span * drawn;
          const done = progress >= endAt;
          const isHover = hover?.id === lane.id;
          const isSelected = selectedId === lane.id;
          const active = isHover || isSelected;

          // A lane ending at the last stage has no room to its right, so its
          // mark and label flip to the inside rather than hanging off the frame.
          const endX = left + span * endAt;
          const nearRight = endX > w - 120;
          const markX = nearRight ? endX - 13 : endX + 5;
          const labelX = nearRight ? endX - 24 : endX + (lane.survived ? 14 : 16);
          const labelAnchor = nearRight ? "end" : "start";

          return (
            <g
              key={lane.id}
              className="lane"
              onMouseEnter={() => setHover(lane)}
              onClick={() => onSelect(lane)}
              style={{ cursor: "pointer" }}
            >
              {/* Generous invisible target: the lanes are 1px apart. */}
              <rect
                x={left}
                y={y - (laneBottom - laneTop) / (2 * Math.max(n - 1, 1)) - 1}
                width={span}
                height={(laneBottom - laneTop) / Math.max(n - 1, 1) + 2}
                fill="transparent"
              />

              <line
                x1={left}
                x2={x2}
                y1={y}
                y2={y}
                stroke={lane.survived ? INK.pos : INK.primary}
                strokeWidth={lane.survived ? 1.3 : active ? 1.4 : 1}
                opacity={lane.survived ? 1 : active ? 0.75 : 0.16}
                style={{ transition: "opacity 140ms, stroke-width 140ms" }}
              />

              {done && !lane.survived && (
                <text
                  x={markX}
                  y={y + 3.5}
                  fill={INK.neg}
                  fontSize={10}
                  opacity={active ? 1 : 0.55}
                  fontFamily="var(--font-mono)"
                  style={{ transition: "opacity 140ms" }}
                >
                  ×
                </text>
              )}

              {lane.survived && progress >= 0.98 && (
                <>
                  <circle cx={right} cy={y} r={3.4} fill={INK.pos} />
                  <circle
                    cx={right}
                    cy={y}
                    r={active ? 10 : 8}
                    fill="none"
                    stroke={INK.pos}
                    opacity={active ? 0.6 : 0.35}
                    style={{ transition: "r 140ms, opacity 140ms" }}
                  />
                </>
              )}

              {/* Selection is a bracket, not a fill. */}
              {isSelected && (
                <>
                  <line x1={left - 4} x2={left - 4} y1={y - 4} y2={y + 4}
                    stroke={INK.primary} strokeWidth={1} />
                  <text x={labelX} y={y + 3.5} textAnchor={labelAnchor}
                    fill={INK.primary} fontSize={9} letterSpacing="0.12em"
                    fontFamily="var(--font-mono)">
                    {lane.dataset?.id ?? ""}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>

      {/* Hover readout: the instrument behind the lane. */}
      {hover && (
        <div className="lane-tip" style={{ top: laneY(hover.rank) + 14 }}>
          <p className="meta lane-tip-id">
            {hover.dataset ? `DATA / ${hover.dataset.id}` : "—"}
          </p>
          <p className="lane-tip-name">{hover.dataset?.name ?? "Unknown source"}</p>
          <dl className="lane-tip-grid">
            <div>
              <dt className="meta">Region</dt>
              <dd className="mono">{hover.dataset?.region ?? "—"}</dd>
            </div>
            <div>
              <dt className="meta">Frequency</dt>
              <dd className="mono">{hover.dataset?.frequency ?? "—"}</dd>
            </div>
            <div>
              <dt className="meta">Quality</dt>
              <dd className="mono">{hover.dataset?.quality ?? "—"}</dd>
            </div>
            <div>
              <dt className="meta">IC</dt>
              <dd className="mono">{hover.ic.toFixed(3)}</dd>
            </div>
          </dl>
          <p className={`meta lane-tip-verdict ${hover.survived ? "pos" : "neg"}`}>
            {hover.survived ? "Survived validation" : `Failed at ${hover.diedAtLabel}`}
          </p>
          <p className="meta muted lane-tip-hint">Click for full record</p>
        </div>
      )}

      <p className="meta muted funnel-note">
        Showing {data.sampled} of {data.tested.toLocaleString("en-US")} tested
        relationships. Hover a lane for its instrument, click for the full record.
      </p>
    </div>
  );
}

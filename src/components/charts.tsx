import { useCallback, useEffect, useState } from "react";
import { useWidth } from "./useWidth";

/* ============================================================
   Shared plotting primitives.
   Black ground, thin white lines, grayscale secondaries.
   ============================================================ */

export const INK = {
  primary: "#F7F7F8",
  mid: "#A5A6AA",
  dark: "#4C4E54",
  grid: "#18191D",
  axis: "#24262B",
  /* Sign and verdict only. Desaturated so a chart still reads as an
     instrument rather than a trading screen. */
  pos: "#3E9E70",
  neg: "#C2564E",
  posWash: "rgba(62, 158, 112, 0.14)",
  negWash: "rgba(194, 86, 78, 0.14)",
} as const;

function extent(values: number[]) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  return [lo, hi] as const;
}

/* ============================================================
   LINE CHART
   Each series is scaled to its own range: these are different
   units, and the point is the shape, not the level.
   ============================================================ */

export type LineSeries = {
  label: string;
  values: number[];
  tone: keyof typeof INK;
  width?: number;
  dashed?: boolean;
};

type LineChartProps = {
  series: LineSeries[];
  height?: number;
  /** Index where out-of-sample validation begins. */
  oosIndex?: number;
  /** Draws the lead offset as a bracket between two x positions. */
  leadMarker?: { at: number; lagSteps: number; label: string };
  xLabels?: string[];
  animate?: boolean;
  /**
   * Put every series on one scale. Only correct when the series share units
   * (two equity curves do; an observation and a price do not).
   */
  sharedScale?: boolean;
  /**
   * Shade the gap between two series, coloured by which is ahead.
   * Requires sharedScale, since otherwise the band and the lines would be
   * drawn against different axes.
   */
  band?: { a: number; b: number };
  /**
   * Colour the target series by whether the leading observation actually
   * called each move — green while the relationship is working, red while it
   * is not. Smoothed over `window`, because a single day's hit is noise and
   * per-step colouring would read as confetti.
   */
  agreement?: {
    /** Series index of the leading observation. */
    predictor: number;
    /** Series index of the asset being predicted. */
    target: number;
    /** How many samples the predictor leads by. */
    lagSteps: number;
    window?: number;
  };
};

export function LineChart({
  series,
  height = 380,
  oosIndex,
  leadMarker,
  xLabels,
  animate = true,
  sharedScale = false,
  band,
  agreement,
}: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(!animate);

  const padL = 0;
  const padR = 0;
  const padT = 18;
  // The bottom band carries the axis labels and, when an agreement layer is
  // present, the hit strip sitting just under the plot. Sized for the label
  // type: too little and the strip runs into the labels.
  const padB = xLabels ? 34 : 10;

  const n = series[0]?.values.length ?? 0;
  const plotW = Math.max(width - padL - padR, 0);
  const plotH = Math.max(height - padT - padB, 0);

  useEffect(() => {
    if (!animate) return;
    const t = setTimeout(() => setDrawn(true), 60);
    return () => clearTimeout(t);
  }, [animate]);

  const x = useCallback(
    (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * plotW),
    [n, plotW],
  );

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left - padL) / (plotW || 1);
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  };

  if (width === 0) return <div ref={ref} style={{ height }} />;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <svg
        width={width}
        height={height}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ display: "block", overflow: "visible" }}
      >
        {/* Horizontal grid — barely there. */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={padL}
            x2={padL + plotW}
            y1={padT + f * plotH}
            y2={padT + f * plotH}
            stroke={INK.grid}
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
        ))}

        {/* Out-of-sample boundary */}
        {oosIndex !== undefined && (
          <g>
            <line
              x1={x(oosIndex)}
              x2={x(oosIndex)}
              y1={padT - 8}
              y2={padT + plotH}
              stroke={INK.primary}
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.55}
              shapeRendering="crispEdges"
            />
            <text
              x={x(oosIndex) + 7}
              y={padT - 2}
              fill={INK.mid}
              fontSize={10}
              letterSpacing="0.14em"
              fontWeight={500}
            >
              OUT OF SAMPLE
            </text>
          </g>
        )}

        {/* Gap between two curves: green where the signal version is ahead,
            red where it is behind. This is the whole claim in one shape. */}
        {band && sharedScale && (() => {
          const A = series[band.a]?.values;
          const B = series[band.b]?.values;
          if (!A || !B) return null;
          const [blo, bhi] = extent([...A, ...B]);
          const by = (v: number) => padT + plotH - ((v - blo) / (bhi - blo || 1)) * plotH;

          type Seg = { sign: number; from: number; to: number };
          const segs: Seg[] = [];
          let cur: Seg | null = null;
          for (let i = 0; i < A.length; i++) {
            const sign = A[i] >= B[i] ? 1 : -1;
            if (!cur || cur.sign !== sign) {
              if (cur) segs.push(cur);
              cur = { sign, from: Math.max(0, i - 1), to: i };
            } else {
              cur.to = i;
            }
          }
          if (cur) segs.push(cur);

          return segs.map((sg, k) => {
            const idx: number[] = [];
            for (let i = sg.from; i <= sg.to; i++) idx.push(i);
            if (idx.length < 2) return null;
            const top = idx.map((i, j) => `${j ? "L" : "M"}${x(i)} ${by(A[i])}`).join("");
            const bot = idx.slice().reverse().map((i) => `L${x(i)} ${by(B[i])}`).join("");
            return (
              <path
                key={k}
                d={`${top}${bot}Z`}
                fill={sg.sign > 0 ? INK.posWash : INK.negWash}
                style={{ opacity: drawn ? 1 : 0, transition: "opacity 900ms 600ms" }}
              />
            );
          });
        })()}

        {/* Series, drawn back to front so white sits on top. */}
        {series
          .map((s, idx) => ({ s, idx }))
          .reverse()
          .map(({ s, idx }) => {
          const [lo, hi] = sharedScale
            ? extent(series.flatMap((q) => q.values))
            : extent(s.values);
          const y = (v: number) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;
          const d = s.values.map((v, i) => `${i ? "L" : "M"}${x(i)} ${y(v)}`).join(" ");
          // The agreement layer redraws this one in colour on top, so the
          // base line only needs to carry the stretches it cannot cover.
          const underlay = agreement?.target === idx;
          return (
            <path
              key={s.label}
              d={d}
              fill="none"
              opacity={underlay ? 0.28 : 1}
              stroke={INK[s.tone]}
              strokeWidth={s.width ?? 1}
              strokeDasharray={s.dashed ? "4 3" : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
              style={{
                // Line-drawing reveal: the system is plotting, not decorating.
                strokeDasharray: s.dashed ? "4 3" : 4000,
                strokeDashoffset: s.dashed ? 0 : drawn ? 0 : 4000,
                transition: "stroke-dashoffset 1600ms cubic-bezier(0.22,0.61,0.36,1)",
              }}
            />
          );
        })}

        {/* Did the observation actually call each move? Green while the
            relationship is working, red while it is not. The interesting
            question is whether the green survives the out-of-sample line. */}
        {agreement && (() => {
          const P = series[agreement.predictor]?.values;
          const T = series[agreement.target]?.values;
          if (!P || !T) return null;

          const lag = agreement.lagSteps;
          const win = agreement.window ?? 24;

          // hit[i] = the observation was above its own recent level `lag`
          // samples ago, and the target then moved up (or the mirror case).
          //
          // Deliberately the predictor's LEVEL against the target's CHANGE,
          // which is what an information coefficient measures. Comparing two
          // changes instead tests something the signal never claimed and
          // comes out at a coin flip.
          const hit: (boolean | null)[] = T.map((_, i) => {
            const j = i - lag;
            if (i < 1 || j < 0) return null;
            const from = Math.max(0, j - win);
            let mean = 0;
            for (let q = from; q <= j; q++) mean += P[q];
            mean /= j - from + 1;

            const dT = T[i] - T[i - 1];
            const dev = P[j] - mean;
            if (dT === 0 || dev === 0) return null;
            return dT > 0 === dev > 0;
          });

          // Running advantage over a coin flip: +1 per hit, -1 per miss.
          //
          // A thresholded hit rate sits on a knife edge — real alpha here is
          // about 52%, so it would flicker every few samples and read as
          // noise. The cumulative score answers the question actually worth
          // asking: has the signal been gaining or losing ground lately.
          const score: number[] = [];
          let run = 0;
          for (let i = 0; i < hit.length; i++) {
            if (hit[i] !== null) run += hit[i] ? 1 : -1;
            score.push(run);
          }

          const working = score.map((v, i) =>
            i < win ? null : v > score[i - win],
          );

          const [lo, hi] = sharedScale
            ? extent(series.flatMap((q) => q.values))
            : extent(T);
          const ty = (v: number) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;

          // Batch into runs so the line reads as phases, not as noise.
          type Run = { on: boolean; from: number; to: number };
          const runs: Run[] = [];
          let cur: Run | null = null;
          for (let i = 0; i < T.length; i++) {
            const w = working[i];
            if (w === null) continue;
            if (!cur || cur.on !== w) {
              if (cur) runs.push(cur);
              cur = { on: w, from: Math.max(0, i - 1), to: i };
            } else {
              cur.to = i;
            }
          }
          if (cur) runs.push(cur);

          const stripY = padT + plotH + 6;

          return (
            <g style={{ opacity: drawn ? 1 : 0, transition: "opacity 800ms 700ms" }}>
              {runs.map((r, k) => {
                const d = [];
                for (let i = r.from; i <= r.to; i++) {
                  d.push(`${i === r.from ? "M" : "L"}${x(i)} ${ty(T[i])}`);
                }
                return (
                  <path
                    key={k}
                    d={d.join("")}
                    fill="none"
                    stroke={r.on ? INK.pos : INK.neg}
                    strokeWidth={1.6}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                );
              })}

              {/* Raw per-sample hits as a density strip. At 1px these read as
                  texture rather than as individual marks. */}
              {hit.map((h, i) =>
                h === null ? null : (
                  <line
                    key={i}
                    x1={x(i)}
                    x2={x(i)}
                    y1={stripY}
                    y2={stripY + 5}
                    stroke={h ? INK.pos : INK.neg}
                    strokeWidth={1}
                    opacity={0.5}
                    shapeRendering="crispEdges"
                  />
                ),
              )}
            </g>
          );
        })()}

        {/* Lead bracket — makes the offset literal. */}
        {leadMarker && (
          <g opacity={0.9}>
            <line
              x1={x(leadMarker.at)}
              x2={x(leadMarker.at + leadMarker.lagSteps)}
              y1={padT + 10}
              y2={padT + 10}
              stroke={INK.primary}
              strokeWidth={1}
            />
            {[leadMarker.at, leadMarker.at + leadMarker.lagSteps].map((p) => (
              <line
                key={p}
                x1={x(p)}
                x2={x(p)}
                y1={padT + 5}
                y2={padT + 15}
                stroke={INK.primary}
                strokeWidth={1}
              />
            ))}
            <text
              x={x(leadMarker.at + leadMarker.lagSteps) + 8}
              y={padT + 14}
              fill={INK.primary}
              fontSize={11}
              letterSpacing="0.1em"
            >
              {leadMarker.label}
            </text>
          </g>
        )}

        {/* Crosshair */}
        {hover !== null && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={padT}
              y2={padT + plotH}
              stroke={INK.primary}
              strokeWidth={1}
              opacity={0.35}
              shapeRendering="crispEdges"
            />
            {series.map((s) => {
              const [lo, hi] = extent(s.values);
              const v = s.values[hover];
              const cy = padT + plotH - ((v - lo) / (hi - lo)) * plotH;
              return (
                <circle
                  key={s.label}
                  cx={x(hover)}
                  cy={cy}
                  r={2.5}
                  fill="#000"
                  stroke={INK[s.tone]}
                  strokeWidth={1}
                />
              );
            })}
          </g>
        )}

        {/* Sparse x labels */}
        {xLabels &&
          xLabels.map((lab, i) => {
            const pos = (i / (xLabels.length - 1)) * (n - 1);
            return (
              <text
                key={lab + i}
                x={x(pos)}
                y={height - 6}
                fill={INK.dark}
                fontSize={10}
                letterSpacing="0.12em"
                textAnchor={i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle"}
              >
                {lab}
              </text>
            );
          })}
      </svg>

      {/* Readout replaces a legend: values only when the user asks. */}
      <div
        style={{
          display: "flex",
          gap: 28,
          marginTop: 14,
          minHeight: 16,
          flexWrap: "wrap",
        }}
      >
        {series.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span
              style={{
                width: 14,
                height: 0,
                borderTop: `${s.width ?? 1}px ${s.dashed ? "dashed" : "solid"} ${INK[s.tone]}`,
                display: "inline-block",
              }}
            />
            <span className="meta">{s.label}</span>
            {hover !== null && (
              <span className="meta meta-1" style={{ letterSpacing: "0.06em" }}>
                {s.values[hover].toFixed(2)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   SPARKLINE
   ============================================================ */

export function Sparkline({
  values,
  width = 96,
  height = 26,
  tone = "mid",
  /** Draw a zero line and colour the trace by sign. */
  signed = false,
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: keyof typeof INK;
  signed?: boolean;
}) {
  // A signed sparkline must include zero, or "above the line" means nothing.
  const [rawLo, rawHi] = extent(values);
  const lo = signed ? Math.min(rawLo, 0) : rawLo;
  const hi = signed ? Math.max(rawHi, 0) : rawHi;
  const span = hi - lo || 1;

  const X = (i: number) => (i / (values.length - 1)) * width;
  const Y = (v: number) => height - ((v - lo) / span) * height;

  const d = values.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");

  if (!signed) {
    return (
      <svg width={width} height={height} style={{ display: "block" }}>
        <path d={d} fill="none" stroke={INK[tone]} strokeWidth={1} />
      </svg>
    );
  }

  const zeroY = Y(0);
  const clipPos = `sp-pos-${values.length}-${Math.round(width)}`;
  const clipNeg = `sp-neg-${values.length}-${Math.round(width)}`;

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <defs>
        {/* One path, clipped twice, so the line changes colour exactly where
            it crosses zero rather than at a vertex. */}
        <clipPath id={clipPos}>
          <rect x={0} y={0} width={width} height={Math.max(zeroY, 0)} />
        </clipPath>
        <clipPath id={clipNeg}>
          <rect x={0} y={zeroY} width={width} height={Math.max(height - zeroY, 0)} />
        </clipPath>
      </defs>
      <line x1={0} x2={width} y1={zeroY} y2={zeroY} stroke={INK.axis} shapeRendering="crispEdges" />
      <path d={d} fill="none" stroke={INK.pos} strokeWidth={1} clipPath={`url(#${clipPos})`} />
      <path d={d} fill="none" stroke={INK.neg} strokeWidth={1} clipPath={`url(#${clipNeg})`} />
    </svg>
  );
}

/* ============================================================
   LAG PROFILE
   Which lead length actually carries the information.
   ============================================================ */

export function LagChart({
  data,
  bestLag,
  height = 150,
}: {
  data: { lag: number; ic: number }[];
  bestLag: number;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  if (width === 0) return <div ref={ref} style={{ height }} />;

  const padB = 22;
  const plotH = height - padB;

  // Room for both signs, so a negative lead reads as below the line rather
  // than as a short positive bar.
  const hi = Math.max(...data.map((d) => d.ic), 0);
  const lo = Math.min(...data.map((d) => d.ic), 0);
  const span = hi - lo || 1;
  const zeroY = ((hi - 0) / span) * (plotH - 10) + 5;
  const scale = (v: number) => (Math.abs(v) / span) * (plotH - 10);

  const slot = width / data.length;
  const barW = Math.min(slot * 0.42, 20);

  return (
    <div ref={ref}>
      <svg width={width} height={height} style={{ display: "block" }}>
        {/* Zero is the reference that makes sign meaningful. */}
        <line
          x1={0}
          x2={width}
          y1={zeroY}
          y2={zeroY}
          stroke={INK.axis}
          shapeRendering="crispEdges"
        />
        {data.map((d, i) => {
          const cx = i * slot + slot / 2;
          const h = Math.max(scale(d.ic), 1);
          const positive = d.ic >= 0;
          const isBest = d.lag === bestLag;
          return (
            <g key={d.lag}>
              <rect
                x={cx - barW / 2}
                y={positive ? zeroY - h : zeroY}
                width={barW}
                height={h}
                // Sign carries the colour; selection carries the opacity.
                fill={positive ? INK.pos : INK.neg}
                opacity={isBest ? 1 : 0.42}
                style={{
                  transition: "height 700ms cubic-bezier(0.22,0.61,0.36,1)",
                }}
              />
              {/* The chosen lead is marked in white, not recoloured. */}
              {isBest && (
                <line
                  x1={cx - barW / 2 - 2}
                  x2={cx + barW / 2 + 2}
                  y1={positive ? zeroY - h - 4 : zeroY + h + 4}
                  y2={positive ? zeroY - h - 4 : zeroY + h + 4}
                  stroke={INK.primary}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
              )}
              <text
                x={cx}
                y={height - 7}
                fill={isBest ? INK.primary : INK.dark}
                fontSize={10}
                letterSpacing="0.1em"
                textAnchor="middle"
              >
                {d.lag}D
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ============================================================
   SCATTER
   Signal at t-k against forward return at t, with a fitted line.
   ============================================================ */

export function Scatter({
  points,
  height = 220,
}: {
  points: { x: number; y: number }[];
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  if (width === 0) return <div ref={ref} style={{ height }} />;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [xlo, xhi] = extent(xs);
  const [ylo, yhi] = extent(ys);

  // Inset by the marker radius so the extreme points sit fully inside the
  // box. Mapping straight onto [0, width] puts the outermost dot's centre on
  // the edge, and half of it then hangs outside the page.
  const R = 1.6;
  const px = (v: number) => R + ((v - xlo) / (xhi - xlo)) * (width - R * 2);
  const py = (v: number) => height - R - ((v - ylo) / (yhi - ylo)) * (height - R * 2);

  // Ordinary least squares — the line is the claim being made.
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < points.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = num / den;
  const intercept = my - slope * mx;

  return (
    <div ref={ref}>
      <svg width={width} height={height} style={{ display: "block" }}>
        <line
          x1={px(0)}
          x2={px(0)}
          y1={0}
          y2={height}
          stroke={INK.grid}
          shapeRendering="crispEdges"
        />
        <line
          x1={0}
          x2={width}
          y1={py(0)}
          y2={py(0)}
          stroke={INK.grid}
          shapeRendering="crispEdges"
        />
        {points.map((p, i) => (
          // Agreement with the fitted sign: points in the expected quadrants
          // support the relationship, the rest are the noise it survives.
          <circle
            key={i}
            cx={px(p.x)}
            cy={py(p.y)}
            r={1.6}
            fill={p.x * p.y * slope > 0 ? INK.pos : INK.neg}
            opacity={0.6}
          />
        ))}
        <line
          x1={px(xlo)}
          y1={py(slope * xlo + intercept)}
          x2={px(xhi)}
          y2={py(slope * xhi + intercept)}
          stroke={INK.primary}
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}

/* ============================================================
   STABILITY BAR
   A proportion, drawn as a proportion.
   ============================================================ */

export function StabilityBar({ pct }: { pct: number }) {
  return (
    <div
      style={{
        height: 2,
        background: "#1A1A1A",
        width: "100%",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${pct}%`,
          background: INK.primary,
          transition: "width 900ms cubic-bezier(0.22,0.61,0.36,1)",
        }}
      />
    </div>
  );
}

import { fingerprint } from "../lib/series";

/* ============================================================
   VISUAL DNA
   Five primitives, reused everywhere: fingerprints, traces,
   lag markers, observation points, system metadata.
   Each one encodes a measured property. None are decorative.
   ============================================================ */

/* ------------------------------------------------------------
   SIGNAL FINGERPRINT
   Response strength across leads. Bar height is the measured
   relationship at that lead; the filled bar is the selected
   lead; a fragile signal reads as visibly smeared because its
   response is spread across neighbouring leads.
   ------------------------------------------------------------ */

export function Fingerprint({
  signal,
  width = 104,
  height = 30,
  showAxis = false,
  id,
}: {
  signal: { bestLag: number; ic: number; stability: number; seed: number };
  width?: number;
  height?: number;
  showAxis?: boolean;
  id?: string;
}) {
  const bars = fingerprint(signal);
  const slot = width / bars.length;
  const barW = Math.max(slot * 0.56, 2);
  const axisH = showAxis ? 12 : 0;
  const plotH = height - axisH;

  return (
    <svg
      width={width}
      height={height}
      style={{ display: "block", overflow: "visible" }}
      role="img"
      aria-label={`Response by lead, strongest at ${signal.bestLag} days`}
      data-fingerprint={id}
    >
      {bars.map((b, i) => {
        const h = Math.max(b.weight * plotH, 1.5);
        const x = i * slot + (slot - barW) / 2;
        return (
          <rect
            key={b.lag}
            x={x}
            y={plotH - h}
            width={barW}
            height={h}
            fill="#FFFFFF"
            // Opacity carries confidence; only the selected lead is solid.
            opacity={b.peak ? 1 : 0.16 + b.weight * 0.34}
          />
        );
      })}

      {/* Baseline */}
      <line x1={0} x2={width} y1={plotH} y2={plotH} stroke="#242424" shapeRendering="crispEdges" />

      {showAxis &&
        bars.map((b, i) =>
          b.lag % 2 === 0 ? (
            <text
              key={b.lag}
              x={i * slot + slot / 2}
              y={height - 1}
              textAnchor="middle"
              fill={b.peak ? "#A1A1A1" : "#3A3A3A"}
              fontSize={8.5}
              letterSpacing="0.06em"
              fontFamily="var(--font-mono)"
            >
              {b.lag}
            </text>
          ) : null,
        )}
    </svg>
  );
}

/* ------------------------------------------------------------
   SIGNAL TRACE
   A thin waveform standing for a physical dataset.
   State is carried by the line itself, not by a badge:
     continuous — validated
     broken     — rejected, the line stops where it failed
     dotted     — no observation exists
   ------------------------------------------------------------ */

function wave(seed: number, n: number, w: number, h: number) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pts: [number, number][] = [];
  let v = 0;
  for (let i = 0; i < n; i++) {
    v = v * 0.72 + (rnd() - 0.5) * 1.6;
    pts.push([(i / (n - 1)) * w, h / 2 - Math.max(-2.2, Math.min(2.2, v)) * (h / 5.4)]);
  }
  return pts;
}

export function Trace({
  seed,
  width = 220,
  height = 26,
  state = "continuous",
  /** Fraction of the width at which a rejected trace breaks. */
  breakAt = 0.65,
  tone = "#FFFFFF",
  opacity = 0.85,
}: {
  seed: number;
  width?: number;
  height?: number;
  state?: "continuous" | "broken" | "dotted";
  breakAt?: number;
  tone?: string;
  opacity?: number;
}) {
  const n = 64;
  const pts = wave(seed, n, width, height);
  const cut = Math.floor(n * breakAt);

  const path = (from: number, to: number) =>
    pts
      .slice(from, to)
      .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(" ");

  if (state === "dotted") {
    return (
      <svg width={width} height={height} style={{ display: "block" }}>
        <path d={path(0, n)} fill="none" stroke={tone} strokeWidth={1} strokeDasharray="1 4" opacity={0.4} />
      </svg>
    );
  }

  if (state === "broken") {
    return (
      <svg width={width} height={height} style={{ display: "block" }}>
        <path d={path(0, cut)} fill="none" stroke={tone} strokeWidth={1} opacity={opacity * 0.55} />
        {/* The break is the finding: nothing survives past this point. */}
        <line
          x1={pts[cut][0]}
          x2={pts[cut][0]}
          y1={2}
          y2={height - 2}
          stroke="#C2564E"
          strokeWidth={1}
          shapeRendering="crispEdges"
        />
        <path
          d={path(cut, n)}
          fill="none"
          stroke={tone}
          strokeWidth={1}
          strokeDasharray="1 4"
          opacity={0.22}
        />
      </svg>
    );
  }

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <path d={path(0, n)} fill="none" stroke={tone} strokeWidth={1} opacity={opacity} />
    </svg>
  );
}

/* ------------------------------------------------------------
   LAG MARKERS
   T-7D … T0 across a rule. Establishes that everything in this
   product is measured against a moment.
   ------------------------------------------------------------ */

export function LagMarkers({
  lead,
  width = 260,
  max = 9,
}: {
  lead: number;
  width?: number;
  max?: number;
}) {
  const ticks = [max, Math.round(max * 0.66), Math.round(max * 0.33), 0];
  const pos = (d: number) => ((max - d) / max) * width;

  return (
    <svg width={width} height={26} style={{ display: "block", overflow: "visible" }}>
      <line x1={0} x2={width} y1={7} y2={7} stroke="#1A1A1A" shapeRendering="crispEdges" />
      {ticks.map((d) => (
        <g key={d}>
          <line x1={pos(d)} x2={pos(d)} y1={3} y2={11} stroke="#2E2E2E" shapeRendering="crispEdges" />
          <text
            x={pos(d)}
            y={22}
            textAnchor={d === max ? "start" : d === 0 ? "end" : "middle"}
            fill="#4A4A4A"
            fontSize={9}
            letterSpacing="0.1em"
            fontFamily="var(--font-mono)"
          >
            {d === 0 ? "T0" : `T-${d}D`}
          </text>
        </g>
      ))}
      {/* The measured lead, marked as an observation point. */}
      <circle cx={pos(lead)} cy={7} r={2.6} fill="#FFFFFF" />
      <line x1={pos(lead)} x2={pos(lead)} y1={0} y2={14} stroke="#FFFFFF" strokeWidth={1} opacity={0.5} />
    </svg>
  );
}

/* ------------------------------------------------------------
   SYSTEM METADATA
   The machine-voice register. Small, mono, slash-delimited.
   ------------------------------------------------------------ */

export function SysMeta({
  rows,
  inline = false,
}: {
  rows: [string, string][];
  inline?: boolean;
}) {
  return (
    <div className={inline ? "sys sys-inline" : "sys"}>
      {rows.map(([k, v]) => (
        <span key={k} className="sys-row">
          <span className="sys-key">{k}</span>
          <span className="sys-sep">/</span>
          <span className="sys-val">{v}</span>
        </span>
      ))}
    </div>
  );
}

/** Latitude/longitude, rendered as an observation coordinate. */
export function Coords({ lat, lon }: { lat: number; lon: number }) {
  const fmt = (v: number, pos: string, neg: string) =>
    `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;
  return (
    <span className="coords">
      {fmt(lat, "N", "S")}
      <span className="coords-gap" />
      {fmt(lon, "E", "W")}
    </span>
  );
}

/* ------------------------------------------------------------
   OBSERVATION POINT
   One glyph vocabulary, used identically everywhere:
     ●  reporting      ○  historical
     ┄  requested      ×  unavailable
   ------------------------------------------------------------ */

export function ObsGlyph({ status }: { status: string }) {
  if (status === "reporting") return <span className="glyph glyph-on">●</span>;
  if (status === "historical") return <span className="glyph glyph-hist">○</span>;
  if (status === "requested") return <span className="glyph glyph-req">┄</span>;
  return <span className="glyph glyph-none">×</span>;
}

/* ------------------------------------------------------------
   STRENGTH
   Confidence as line density rather than a coloured badge.
   ------------------------------------------------------------ */

export function StrengthBars({ level }: { level: "HIGH" | "MODERATE" | "LOW" }) {
  const filled = level === "HIGH" ? 3 : level === "MODERATE" ? 2 : 1;
  return (
    <span className="strength" aria-label={level}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={`strength-bar ${i < filled ? "is-on" : ""}`} />
      ))}
    </span>
  );
}

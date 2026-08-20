import { useId, useMemo, useState } from "react";
import { useWidth } from "./useWidth";
import { BORDER_LINES, LAND_POLYGONS, type Ring } from "../data/worldmap";

export type Site = {
  city: string;
  country: string;
  lat: number;
  lon: number;
  label: string;
  status?: "reporting" | "historical";
};

export type GapSite = { city: string; country: string; lat: number; lon: number; label: string };

/* ============================================================
   OBSERVATION FIELD
   Not a network explorer. A record of where reality is being
   measured, where it is only archived, where measurement has
   been requested, and where nothing is watching at all.
   ============================================================ */

const RATIO = 0.5;

const TONE = {
  reporting: "#F7F7F8",
  historical: "#A5A6AA",
  gap: "#5B5D64",
} as const;

export function ObservationField({ sites, gaps }: { sites: Site[]; gaps: GapSite[] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<string | null>(null);
  const clipId = useId();

  const h = w * RATIO;
  const px = (lon: number) => ((lon + 180) / 360) * w;
  const py = (lat: number) => ((78 - lat) / 156) * h;

  // ~8,600 vertices, so the path strings are built once per width rather than
  // on every hover. Both layers collapse into a single path element each.
  const { landPath, borderPath } = useMemo(() => {
    if (w === 0) return { landPath: "", borderPath: "" };

    const X = (lon: number) => (((lon + 180) / 360) * w).toFixed(1);
    const Y = (lat: number) => (((78 - lat) / 156) * (w * RATIO)).toFixed(1);
    const draw = (r: Ring) => r.map(([lon, lat], i) => `${i ? "L" : "M"}${X(lon)} ${Y(lat)}`).join("");

    return {
      landPath: LAND_POLYGONS.map((poly) => poly.map((r) => draw(r) + "Z").join("")).join(""),
      borderPath: BORDER_LINES.map(draw).join(""),
    };
  }, [w]);

  if (w === 0) return <div ref={ref} style={{ height: 440 }} />;


  return (
    <div ref={ref} className="field">
      <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
        <defs>
          {/* Greenland and the far south run past the crop; clip rather than
              letting coastlines bleed outside the frame. */}
          <clipPath id={clipId}>
            <rect x={0} y={0} width={w} height={h} />
          </clipPath>
        </defs>

        <g clipPath={`url(#${clipId})`}>
          {/* Graticule — establishes that these are coordinates. */}
          {[-60, -30, 0, 30, 60].map((lat) => (
            <line key={lat} x1={0} x2={w} y1={py(lat)} y2={py(lat)}
              stroke={lat === 0 ? "#18191D" : "#0D0E10"} shapeRendering="crispEdges" />
          ))}
          {[-120, -60, 0, 60, 120].map((lon) => (
            <line key={lon} x1={px(lon)} x2={px(lon)} y1={0} y2={h}
              stroke={lon === 0 ? "#18191D" : "#0D0E10"} shapeRendering="crispEdges" />
          ))}

          {/* Coastline. evenodd so inland seas read as water, not land. */}
          <path
            d={landPath}
            fillRule="evenodd"
            fill="#070709"
            stroke="#2A2B31"
            strokeWidth={0.8}
            strokeLinejoin="round"
          />

          {/* Internal borders, a full step quieter than the coast. */}
          <path
            d={borderPath}
            fill="none"
            stroke="#1A1B1F"
            strokeWidth={0.6}
            strokeLinejoin="round"
          />
        </g>

        {/* Sites carrying live or archived observations. */}
        {sites.map((o) => {
          const cx = px(o.lon);
          const cy = py(o.lat);
          const key = `${o.city}-${o.label}`;
          const lit = active === key;
          const flip = cx > w * 0.78;
          const tx = flip ? cx - 9 : cx + 9;
          const anchor = flip ? "end" : "start";
          const reporting = o.status !== "historical";
          const tone = reporting ? TONE.reporting : TONE.historical;

          return (
            <g key={key} onMouseEnter={() => setActive(key)} onMouseLeave={() => setActive(null)}>
              <circle cx={cx} cy={cy} r={11} fill="transparent" />
              {reporting ? (
                <circle cx={cx} cy={cy} r={2.7} fill={tone} />
              ) : (
                <circle cx={cx} cy={cy} r={2.6} fill="none" stroke={tone} strokeWidth={1} />
              )}
              {lit && <circle cx={cx} cy={cy} r={7} fill="none" stroke="#F7F7F8" opacity={0.28} />}

              <text x={tx} y={cy - 1} textAnchor={anchor}
                fill={lit ? "#F7F7F8" : reporting ? "#A5A6AA" : "#5B5D64"}
                fontSize={9.5} letterSpacing="0.12em" fontFamily="var(--font-mono)"
                style={{ transition: "fill 180ms" }}>
                {o.city.toUpperCase()}
              </text>
              {lit && (
                <text x={tx} y={cy + 9} textAnchor={anchor} fill="#A5A6AA" fontSize={8.5}
                  letterSpacing="0.08em" fontFamily="var(--font-mono)">
                  {o.label.toUpperCase()}
                </text>
              )}
            </g>
          );
        })}

        {/* Coverage gaps. Drawn as an interrupted mark, never a filled node:
            the absence of an observation is the thing being shown. */}
        {gaps.map((g) => {
          const cx = px(g.lon);
          const cy = py(g.lat);
          const key = `gap-${g.city}-${g.label}`;
          const lit = active === key;
          const flip = cx > w * 0.78;
          const tx = flip ? cx - 9 : cx + 9;
          const anchor = flip ? "end" : "start";

          return (
            <g key={key} onMouseEnter={() => setActive(key)} onMouseLeave={() => setActive(null)}>
              <circle cx={cx} cy={cy} r={11} fill="transparent" />
              <line x1={cx - 5} x2={cx + 5} y1={cy} y2={cy} stroke={TONE.gap}
                strokeWidth={1} strokeDasharray="1 2" />
              <text x={tx} y={cy - 1} textAnchor={anchor} fill={lit ? "#F7F7F8" : "#4C4E54"}
                fontSize={9.5} letterSpacing="0.12em" fontFamily="var(--font-mono)"
                style={{ transition: "fill 180ms" }}>
                {g.city.toUpperCase()}
              </text>
              {lit && (
                <text x={tx} y={cy + 9} textAnchor={anchor} fill="#707178" fontSize={8.5}
                  letterSpacing="0.08em" fontFamily="var(--font-mono)">
                  {g.label.toUpperCase()} / NO SOURCE
                </text>
              )}
            </g>
          );
        })}

      </svg>
    </div>
  );
}

/** Legend. Same glyph vocabulary as the map itself. */
export function CoverageLegend({ reporting, historical, gaps }: {
  reporting: number; historical: number; gaps: number;
}) {
  const items: [string, string, number][] = [
    ["●", "Reporting", reporting],
    ["○", "Historical only", historical],
    ["┄", "Coverage gap", gaps],
  ];
  return (
    <div className="field-legend">
      {items.map(([glyph, label, n]) => (
        <span key={label} className="meta field-legend-item">
          <span className="field-glyph">{glyph}</span>
          {label}
          <span className="field-count">{n}</span>
        </span>
      ))}
    </div>
  );
}

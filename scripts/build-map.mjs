/**
 * Generates src/data/worldmap.ts from Natural Earth 1:50m data.
 *
 * Run with: npm run build:map
 *
 * The conversion happens here rather than at runtime so the app ships only
 * coordinate arrays — no TopoJSON parser in the bundle. Geometry is simplified
 * to sub-pixel tolerance for the size the map is actually drawn at, which
 * removes most vertices without any visible loss.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { merge, mesh } from "topojson-client";

const SRC = "node_modules/world-atlas/countries-50m.json";
const OUT = "src/data/worldmap.ts";

/** Widest the map is ever drawn (page max-width less gutters). */
const MAX_WIDTH_PX = 1400;
/** Keep error under half a pixel at that width — imperceptible. */
const TOLERANCE = (360 / MAX_WIDTH_PX) * 0.5;
/** Antarctica is cropped by the viewport anyway. */
const SKIP_IDS = new Set(["010"]);
/** Drop specks below roughly this many square degrees. */
const MIN_AREA = 0.06;

const topo = JSON.parse(readFileSync(SRC, "utf8"));
const countries = topo.objects.countries;

const kept = countries.geometries.filter((g) => !SKIP_IDS.has(String(g.id)));

// Land silhouette, with internal country borders as a separate mesh so each
// shared border is drawn exactly once.
const land = merge(topo, kept);
const borders = mesh(topo, { ...countries, geometries: kept }, (a, b) => a !== b);

/** Perpendicular distance from p to segment ab. */
function segDist(p, a, b) {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** Douglas-Peucker, iterative so deep rings cannot blow the stack. */
function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const sqTol = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxSq = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const sq = segDist(points[i], points[first], points[last]);
      if (sq > maxSq) {
        maxSq = sq;
        index = i;
      }
    }
    if (maxSq > sqTol && index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round = (v) => Math.round(v * 100) / 100;

function cleanRing(ring) {
  const simplified = simplify(ring, TOLERANCE).map(([lon, lat]) => [round(lon), round(lat)]);
  // Rounding can collapse neighbours onto each other.
  const out = [];
  for (const p of simplified) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  return out;
}

/** Shoelace area, used only to discard specks. */
function area(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a / 2);
}

/**
 * Splits geometry that crosses the antimeridian.
 *
 * Russia, Fiji and one Alaskan island wrap past ±180, which in an
 * equirectangular projection would otherwise draw a horizontal streak across
 * the entire map. Discarding them is not an option: Russia is part of the
 * single merged Afro-Eurasia polygon, so dropping it removes the largest
 * landmass on Earth.
 *
 * Natural Earth already places its crossing vertices exactly on ±180, so each
 * piece can simply be cut at the jump and closed along that edge.
 */
function splitAtAntimeridian(points, closed) {
  let pts = points;

  if (closed) {
    const last = pts[pts.length - 1];
    if (pts[0][0] === last[0] && pts[0][1] === last[1]) pts = pts.slice(0, -1);
  }

  const cuts = [];
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i][0] - pts[i - 1][0]) > 180) cuts.push(i);
  }
  if (cuts.length === 0) return [points];

  const pieces = [];
  let prev = 0;
  for (const c of cuts) {
    pieces.push(pts.slice(prev, c));
    prev = c;
  }
  pieces.push(pts.slice(prev));

  if (closed && pieces.length > 1) {
    // Around a closed ring the final piece runs into the first one.
    const tail = pieces.pop();
    pieces[0] = tail.concat(pieces[0]);
  }

  // A vertex sitting on the far side of the seam keeps its own sign, which
  // would drag the piece back across the map. Snap it to this piece's side.
  return pieces
    .filter((p) => p.length >= (closed ? 3 : 2))
    .map((piece) => {
      let sum = 0;
      for (const [lon] of piece) if (Math.abs(lon) < 179.5) sum += lon;
      const side = sum >= 0 ? 180 : -180;
      return piece.map(([lon, lat]) => (Math.abs(lon) >= 179.5 ? [side, lat] : [lon, lat]));
    });
}

// Polygon grouping is preserved: ring 0 is the outer boundary and the rest are
// holes. Kept together in one path with fill-rule evenodd, inland seas such as
// the Caspian punch through instead of filling as land.
const landPolygons = [];
for (const polygon of land.coordinates) {
  const rings = [];
  for (let i = 0; i < polygon.length; i++) {
    for (const part of splitAtAntimeridian(polygon[i], true)) {
      const cleaned = cleanRing(part);
      if (cleaned.length < 4) continue;
      if (area(cleaned) < MIN_AREA) continue;
      rings.push(cleaned);
    }
    // If the outer boundary vanished as a speck, its holes go with it.
    if (i === 0 && rings.length === 0) break;
  }
  if (rings.length) landPolygons.push(rings);
}

const borderLines = [];
for (const line of borders.coordinates) {
  for (const part of splitAtAntimeridian(line, false)) {
    const cleaned = cleanRing(part);
    if (cleaned.length < 2) continue;
    borderLines.push(cleaned);
  }
}

const ring = (r) => `[${r.map(([a, b]) => `[${a},${b}]`).join(",")}]`;
const rings = (list) => list.map(ring).join(",\n  ");
const polys = (list) => list.map((p) => `[${p.map(ring).join(",")}]`).join(",\n  ");

const file = `/* ============================================================
   GENERATED FILE — do not edit by hand.
   Source: Natural Earth 1:50m via world-atlas (public domain).
   Regenerate with: npm run build:map

   Coordinates are [longitude, latitude] in degrees, simplified to
   ~${TOLERANCE.toFixed(3)}° (under half a pixel at ${MAX_WIDTH_PX}px wide)
   and rounded to 2dp. Antarctica is omitted; the map crops below 78°S.
   ============================================================ */

export type Ring = [number, number][];

/**
 * Landmasses. Each entry is one polygon: ring 0 is the coastline and any
 * further rings are holes, so draw them as a single path with
 * fill-rule="evenodd".
 */
export const LAND_POLYGONS: Ring[][] = [
  ${polys(landPolygons)},
];

/** Internal country borders, each shared edge appearing exactly once. */
export const BORDER_LINES: Ring[] = [
  ${rings(borderLines)},
];
`;

writeFileSync(OUT, file);

const count = (a) => a.reduce((n, r) => n + (Array.isArray(r[0][0]) ? count(r) : r.length), 0);
console.log(
  `land polygons ${landPolygons.length.toString().padStart(4)}  ${count(landPolygons)} vertices\n` +
    `border lines  ${borderLines.length.toString().padStart(4)}  ${count(borderLines)} vertices\n` +
    `tolerance     ${TOLERANCE.toFixed(4)}°\n` +
    `written       ${OUT}  ${(Buffer.byteLength(file) / 1024).toFixed(1)} KB`,
);

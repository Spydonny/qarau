/* ============================================================
   DETERMINISTIC SERIES

   Pure functions of a seed. No research content lives here —
   seeds arrive from the authenticated API, and these turn them
   into the same curves on every render.
   ============================================================ */

/** mulberry32 — small, fast, seedable. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller, so the walks have believable tails. */
function gauss(r: () => number) {
  const u = Math.max(r(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

export type Series = {
  signal: number[];
  asset: number[];
  benchmark: number[];
  oosIndex: number;
};

/**
 * Builds an observation series that genuinely leads the target: the target is
 * a lagged, noised copy of the observation plus an independent market term.
 */
export function makeSeries(seed: number, n = 220, lag = 2): Series {
  const r = rng(seed);

  const signal: number[] = [];
  let s = 0;
  for (let i = 0; i < n + lag; i++) {
    s = s * 0.93 + gauss(r) * 0.5 + Math.sin(i / 26) * 0.08;
    signal.push(s);
  }

  const market: number[] = [];
  let m = 0;
  for (let i = 0; i < n; i++) {
    m += gauss(r) * 0.34;
    market.push(m);
  }

  const asset: number[] = [];
  const benchmark: number[] = [];
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    a += signal[i] * 0.16 + gauss(r) * 0.42 + (market[i] - (market[i - 1] ?? 0)) * 0.7;
    b += gauss(r) * 0.3 + (market[i] - (market[i - 1] ?? 0)) * 0.85;
    asset.push(a);
    benchmark.push(b);
  }

  return {
    signal: signal.slice(lag, lag + n),
    asset,
    benchmark,
    oosIndex: Math.floor(n * 0.68),
  };
}

/** Two equity curves — without the signal, and with it. */
export function makeEquity(seed: number, n = 220, lift = 1) {
  const r = rng(seed + 991);
  const base: number[] = [];
  const lifted: number[] = [];
  let x = 100;
  let y = 100;
  for (let i = 0; i < n; i++) {
    const shock = gauss(r);
    x *= 1 + (shock * 0.011 + 0.00042);
    // Same shocks, partially anticipated — smaller drawdowns, better drift.
    y *= 1 + (shock * (0.011 - 0.0016 * lift) + (0.00042 + 0.0004 * lift));
    base.push(x);
    lifted.push(y);
  }
  return { base, lifted, oosIndex: Math.floor(n * 0.68) };
}

/** Scatter of observation value at t-lag against target return at t. */
export function makeScatter(seed: number, n = 180) {
  const r = rng(seed + 4133);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const x = gauss(r);
    pts.push({ x, y: x * 0.31 + gauss(r) * 0.92 });
  }
  return pts;
}

/** Information coefficient by lead — the expanded fingerprint. */
export function makeLagProfile(bestLag: number, peak: number) {
  const out: { lag: number; ic: number }[] = [];
  for (let lag = 0; lag <= 9; lag++) {
    const d = Math.abs(lag - bestLag);
    const ic = peak * Math.exp(-(d * d) / 3.2) - (lag === 0 ? 0.012 : 0);
    out.push({ lag, ic: Math.max(ic, -0.008) });
  }
  return out;
}

/** Rolling information coefficient, used on the signal-health view. */
export function makeRollingIc(seed: number, peak: number, decay: number, n = 120) {
  const r = rng(seed + 517);
  const out: number[] = [];
  let v = peak;
  for (let i = 0; i < n; i++) {
    // decay is 0..100; a high value bends the curve toward zero over the window.
    const drift = (decay / 100) * (peak / n) * 1.9;
    v = v - drift + (r() - 0.5) * peak * 0.42;
    out.push(v);
  }
  return out;
}

export type FingerprintBar = { lag: number; weight: number; peak: boolean };

/**
 * Response curve across leads. A real relationship peaks at one lead and
 * decays either side; noise is flat. Stability controls how tightly the
 * response concentrates, so a fragile signal reads as visibly smeared.
 */
export function fingerprint(sig: {
  bestLag: number;
  ic: number;
  stability: number;
  seed: number;
}): FingerprintBar[] {
  const r = rng(sig.seed + 77);
  const spread = 1.6 + (1 - sig.stability / 100) * 5.5;
  const bars: FingerprintBar[] = [];

  for (let lag = 9; lag >= 0; lag--) {
    const d = lag - sig.bestLag;
    const shape = Math.exp(-(d * d) / spread);
    const noise = (r() - 0.5) * 0.13;
    bars.push({
      lag: -lag,
      weight: Math.max(0.04, Math.min(1, shape + noise)),
      peak: lag === sig.bestLag,
    });
  }
  return bars;
}

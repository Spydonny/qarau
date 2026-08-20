# Qarau / Internal

A private quantitative research system. It searches real-world physical data for
predictive relationships with a financial asset, rejects almost everything, and keeps
what survives out-of-sample validation as proprietary research.

**We do not distribute alpha. We protect it.**

This is not a marketplace, a public research platform, or a product for many users. There
is one owner, one account, and no registration. Signals are internal intellectual property
and are treated that way in the architecture, not just in the copy.

> All research content is **simulated**. There is no live data feed, no backtest engine,
> and nothing here is investment advice.

## Qarau visual system

The UI derives from the supplied Qarau identity rather than reproducing the logo as
decoration. Polished grayscale is reserved for page statements and active controls;
flat interval rules reference the bridge in the mark; near-black raised surfaces
group working context without weakening the data-first hierarchy. Green and red remain
semantic only (positive/negative, passed/failed). Core tokens live in `src/index.css`,
shared application patterns in `src/ui.css` and owner-only patterns in `src/internal.css`.

## Running it

```bash
npm install
```

Set an owner credential — do this before first run:

```bash
npm run auth:hash -- 'a-long-password-you-choose'
```

Put the printed line in `.env` (see `.env.example`), then:

```bash
npm run dev
```

The web app is on http://localhost:5173 and the research API on http://localhost:8787.
Vite proxies `/api` to the server so the session cookie stays first-party in development,
exactly as it is in production.

If `OWNER_PASSWORD_HASH` is unset the server generates a random password at boot and
prints it once. That is deliberate — an unconfigured install is never reachable with a
default credential committed to the repository. It changes on every restart.

For production, `npm run build` then `npm start` serves the built SPA and the API from one
origin.

## Access model

Owner-only, and enforced on the server rather than in the interface.

- **One account.** No registration route, no password reset, no second user.
- **Real credential check.** `scrypt` with a per-credential salt, compared with
  `timingSafeEqual`. The password is never stored, only the digest.
- **Server-side sessions.** A 32-byte random token in an `httpOnly`, `SameSite=Strict`
  cookie (`Secure` in production). Page scripts cannot read it. Sessions expire after 2
  hours idle or 12 hours absolute, and sign-out deletes the session server-side — a
  replayed token is rejected, not merely forgotten by the client.
- **Whole-router protection.** Research routes are mounted under one router with
  `requireOwner` applied to the router itself, so a new endpoint cannot be added
  unprotected by forgetting middleware on an individual route.
- **Throttled login.** Five failures per client address, then a 15-minute lockout. Every
  failure returns an identical `401` — no hint about which part was wrong.
- **Nothing in the bundle.** All research content lives in `server/data/research.mjs`,
  which no file under `src/` imports. The list of assets under research is served from
  `/api/research/config` for the same reason: anything compiled into the client is
  readable by anyone who can fetch the page.

The frontend session context is a rendering convenience only. Editing it in devtools
grants nothing, because every request is checked against the cookie.

### Verified, not assumed

| Check | Result |
| --- | --- |
| All 8 research routes, unauthenticated | `401` |
| Forged / random / empty session token | `401` |
| Wrong, empty, and missing password | `401 invalid_credentials` |
| Correct password | `200`, `HttpOnly; SameSite=Strict` cookie set |
| Old token replayed after sign-out | `401` (invalidated server-side) |
| 6th login attempt, and correct password during lockout | `429` |
| Cookie readable from page JavaScript | no (`document.cookie` empty) |
| Deep links to `/signals`, `/data`, `/runs` while signed out | gate only, zero research text |
| Research strings in the built client bundle | 0 |

### What is MVP-grade

Stated plainly so it is not mistaken for production hardening:

- Sessions are held **in memory**. A restart signs the owner out, and this runs as a
  single instance. Replace this first if it ever runs anywhere real.
- Login throttling is also in memory and keyed by client address.
- There is no CSRF token. `SameSite=Strict` plus a JSON-only API covers the browser cases
  here, but a real deployment should add one.
- No TLS is configured — `Secure` on the cookie only takes effect when
  `NODE_ENV=production` behind a TLS terminator.

## The screens

Navigation is four items and stays that way.

| Route | Purpose |
| --- | --- |
| `/` (signed out) | The front door. States what the system is and asks for a credential. |
| `/discovery` | Configure and run a private discovery: target, universe, horizon. |
| `/signals` | The proprietary inventory, with health and lifecycle status. |
| `/signals/:id` | One confidential research file: thesis, evidence, strategy value, health. |
| `/data` | The private data universe, plus coverage gaps. |
| `/runs` | Every experiment, including the ones that produced nothing. |

**Discovery** shows the system rejecting things: 8,412 relationships tested → 91 past
initial filters → 14 past robustness → 3 out-of-sample → 1 proprietary candidate. The
funnel diagram draws one lane per hypothesis and terminates most of them in `×`. It should
look skeptical, not magical.

Every lane is a real hypothesis — a named dataset paired with the target — served from
`/api/research/runs/:id/lanes`:

- **Hover** reports the instrument behind the lane: dataset id, region, frequency, quality,
  information coefficient, and the stage that killed it.
- **Click** opens the full record below the diagram, for survivors and failures alike:
  provenance and coordinates, the relationship diagram in its validated or rejected state,
  response by lead, the observation plotted against the target, rolling IC, and either a
  link to the signal file or the reason it was discarded.

The diagram draws a readable **sample** of 24 lanes and says so — a run tests thousands and
no diagram shows that many. Two consistency rules hold the sample to the real record: the
final stage count equals the signals the run actually produced, and a surviving lane
inherits its lead, IC, stability and seed from the signal it links to, so the lane and the
research file can never disagree.

The last column is an outcome rather than a filter, so a hypothesis that stops there failed
**selection**, not "PROPRIETARY" — it held out of sample but was too correlated with an
existing signal, or did not clear the allocation threshold. Selection is not purely
statistical and the record says so.

**Signal detail** answers four questions in order: what did we find, why might it matter,
does it hold up, does it improve the strategy. The hypothesis is labelled as a hypothesis —
the copy never claims causality.

**Signal health** treats alpha as perishable. Stability, decay, data quality, regime
robustness and crowding, with a lifecycle of `CANDIDATE → ACTIVE → WATCHLIST → DEGRADING →
RETIRED`. Crowding is labelled a heuristic, because it is one.

**Runs** keeps negative research. A run that produced nothing is still a result: it records
what has already been ruled out.

## Coverage gaps and the acquisition model

The most strategically important screen sits inside Data. When the engine wants a
measurement that does not exist, the gap is the finding.

Each gap separates two things that must never travel together:

- **What to measure** — observation, location, desired frequency. This is what a request
  would carry outward.
- **Why we want it** — shown to the owner, marked *Internal · not in request*, and
  excluded from anything published.

Target hypothesis renders as `Hidden` by design. A contributor needs to know what to
measure, never the target asset, the direction, the strategy, or what the observation is
worth. The future network exists to **acquire observations**, not to distribute what we
learn from them.

Settlement infrastructure is future work and is deliberately absent. There is no wallet in
the interface, and the Solana packages were removed from the dependency tree since nothing
imports them — re-adding is one `npm install` if contributor settlement is built later.

## Visual language

Black ground, a grey text scale, and two semantic tones reserved for verdicts. The identity
comes from a small set of primitives in
[`primitives.tsx`](src/components/primitives.tsx) and
[`Relationship.tsx`](src/components/Relationship.tsx), reused on every screen:

- **Relationship diagram** — an observation on the upper rail, the market on the lower one,
  the lead as the distance between them. Three states carried by the lines themselves:
  joined when validated, terminating in `×` when rejected, dotted when the observation does
  not exist.
- **Signal fingerprint** — response strength across leads. Bar height is the measured
  relationship at that lead; a low-stability signal reads as visibly smeared.
- **Traces** — continuous, broken at the point of failure, or dotted where no data exists.
- **Health as density** — a metric turns negative only past its threshold, so a decay of 8
  is not styled as a warning. Still no coloured badges; the tone is on the rule and the
  figure.
- **Internal identifiers** — `SIG / 0041`, `RUN / 0184`, `DATA / 0182`, `OBS / 0191`, plus
  `ACCESS / OWNER`, `VISIBILITY / INTERNAL`.

Secrecy is conveyed through sparseness, identifiers and system metadata — one restrained
`PROPRIETARY` marker, no stamps, no green terminal text, no theatre.

### Colour

Grayscale still carries the layout. Colour is a **verdict**, restricted to two desaturated
tokens and never used decoratively:

| Token | Meaning |
| --- | --- |
| `--pos` `#3E9E70` | rise, survived validation, true alpha |
| `--neg` `#C2564E` | fall, failed validation, false alpha |

Where it appears: the target line on the main signal chart, bar sign on the lag profile,
the rolling-IC sparkline crossing zero, the shaded gap between the two equity curves,
scatter points that agree or disagree with the fitted sign, surviving versus terminated
lanes in the discovery funnel, signal status, validation verdicts, decay past its
threshold, and the uplift figure.

**On the main signal chart** the asset line is coloured by whether the observation actually
called each move. Two details make this a measurement rather than decoration:

- The hit test compares the observation's **level** against the target's **change**, which
  is what an information coefficient measures. Comparing two changes tests something the
  signal never claimed and comes out at a coin flip.
- Colour follows a running advantage over a coin flip (+1 hit, −1 miss), not a thresholded
  hit rate. Real alpha here is about 55% per sample, so a threshold would sit on a knife
  edge and flicker every few points.

For SIG/0041 that yields a 55.3% raw hit rate and about 65% of the line drawn green — a
validated signal with visible stretches where it stops working, which is what thin alpha
honestly looks like. A chart that came out 90% green would be lying. The strip beneath the
plot is the raw per-sample hit rate, and the question worth asking is whether the green
survives the out-of-sample boundary.

**Palette rule**, tested rather than asserted: a DOM audit across every authenticated route
checks each `color`, `background`, `border`, `fill` and `stroke`, and asserts that any
saturated value matches one of the two tokens. Latest run: **0 off-palette values across
19,224 properties** (422 positive, 198 negative uses; 197 of them inside charts, 15 on
text — status marks, verdicts and the uplift figure).

### Text hierarchy

White is an accent, not the default. `<body>` is `--text-2`; headings, metrics and spans
marked `.key` opt into white explicitly, so roughly 7% of text elements are white and the
eye lands on the few things that matter per screen.

Every level clears WCAG AA on black:

| Token | Contrast |
| --- | --- |
| `--text` `#FFFFFF` | 21.0:1 |
| `--text-2` `#B0B0B0` (body) | 9.68:1 |
| `--text-3` `#787878` (meta) | 4.76:1 |
| `--pos` | 6.33:1 |
| `--neg` | 4.73:1 |

`--text-3` is the floor: most of the interface is 11px uppercase mono at that value, and
darker stops being restraint and becomes unreadable.

### Type scale

Base is 16px. The scale was raised across the board once the interface was legible enough
to judge — the earlier one read as cramped rather than restrained.

| Role | Size |
| --- | --- |
| Body copy | 16px |
| Secondary copy | 14px |
| System metadata (`.meta`, mono uppercase) | 11px |
| Table and row text | 14–15px |
| SVG axis and annotation labels | 9–11px |
| `.h2` | 22px |
| `.h1` | clamp to 46px |

Raising type is not only a font-size change: several grids were sized around the old
metrics and had to grow with it (health-bar labels, the run row, the dataset register, the
signal inventory columns). Two collisions surfaced and were fixed — the chart's bottom band
was too shallow for larger axis labels once the hit strip shared it, and a lane terminating
at the funnel's last stage had no room for its `×`, so its mark and label now flip inward
near the right edge.

## The map

Real geography. [`worldmap.ts`](src/data/worldmap.ts) is **generated** — never edit it by
hand:

```bash
npm run build:map
```

[`scripts/build-map.mjs`](scripts/build-map.mjs) reads Natural Earth 1:50m (via
`world-atlas`, public domain), merges country polygons into a land silhouette, extracts
internal borders as a separate mesh, and simplifies with Douglas-Peucker at `0.129°` —
under half a pixel at render width. `topojson-client` and `world-atlas` are devDependencies
only; the app ships coordinate arrays. The map is lazy-loaded, so only `/data` pays its
57 kB.

Two details that matter: crossing geometry is **split at the antimeridian** rather than
discarded (Russia wraps ±180, and it is part of the merged Afro-Eurasia polygon — discarding
it deletes the largest landmass on Earth), and polygon grouping is preserved so inland seas
render as water. Geography is verified by point-in-polygon against the rendered path:
**17/17** on known land and water coordinates.

## Notes

- `API_PORT`, not `PORT`. Dev tooling routinely sets `PORT` for the web server; inheriting
  it made the API bind Vite's port, and the built `index.html` then got served over the dev
  server with stale asset hashes.
- The discovery clock reads elapsed wall-clock time and runs on both `rAF` and an interval.
  Browsers pause `rAF` in a hidden tab, which would otherwise freeze a run started in the
  background.
- Five `set-state-in-effect` lint warnings are deliberate — each synchronizes with something
  outside React (session bootstrap, fetches, reduced-motion query, animation clock).

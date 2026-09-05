# Graph Report - C:\Users\BIGra\Desktop\solana workshop mvp  (2026-08-24)

## Corpus Check
- Corpus is ~34,150 words - fits in a single context window. You may not need a graph.

## Summary
- 381 nodes · 622 edges · 21 communities (20 shown, 1 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Frontend and API
- UI Visualization Components
- Authentication and Sessions
- Product Thesis and Evidence
- Workspace Package Scripts
- Browser TypeScript Config
- Brand Asset Extraction
- Server TypeScript Config
- Frontend Dependencies
- World Map Pipeline
- QARAU Brand Assets
- Server Package
- Physical Data Mapping
- Application Entry
- Lint Configuration
- Owner Authentication UI
- Social Icon Sprite
- Hero System Visual
- Playwright Snapshot
- TypeScript Project References

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 18 edges
2. `react` - 16 edges
3. `compilerOptions` - 15 edges
4. `useWidth()` - 11 edges
5. `scripts` - 10 edges
6. `extract_variant()` - 9 edges
7. `Qarau / Internal` - 9 edges
8. `build_alpha()` - 8 edges
9. `registerAuthRoutes()` - 8 edges
10. `api` - 7 edges

## Surprising Connections (you probably didn't know these)
- `QARAU Apple touch icon` --conceptually_related_to--> `QARAU stylized Q monogram on dark background`  [INFERRED]
  public/apple-touch-icon.png → src/assets/qarau/monogram-on-dark.png
- `ObservationField()` --calls--> `useWidth()`  [EXTRACTED]
  src/components/ObservationField.tsx → src/components/useWidth.ts
- `QARAU lowercase wordmark on dark background` --references--> `QARAU brand identity`  [INFERRED]
  src/assets/qarau/wordmark-on-dark.png → src/assets/qarau/primary-lockup-on-dark.png
- `FunnelTrace()` --calls--> `useWidth()`  [EXTRACTED]
  src/components/FunnelTrace.tsx → src/components/useWidth.ts
- `QARAU 32-pixel favicon` --conceptually_related_to--> `QARAU Apple touch icon`  [INFERRED]
  public/favicon-32.png → public/apple-touch-icon.png

## Import Cycles
- None detected.

## Communities (21 total, 1 thin omitted)

### Community 0 - "Frontend and API"
Cohesion: 0.07
Nodes (48): react, api, ApiError, Listener, onUnauthorized(), ResearchConfig, unauthorizedListeners, Ctx (+40 more)

### Community 1 - "UI Visualization Components"
Cohesion: 0.10
Nodes (33): extent(), LagChart(), LineChart(), LineChartProps, LineSeries, Scatter(), Sparkline(), CountUp() (+25 more)

### Community 2 - "Authentication and Sessions"
Cohesion: 0.09
Nodes (36): attempts, authBanner(), clearFailures(), clientKey(), createSession(), hashPassword(), initOwner(), readCookie() (+28 more)

### Community 3 - "Product Thesis and Evidence"
Cohesion: 0.07
Nodes (28): Antimeridian splitting, Coverage gaps, Discovery rejection funnel, Douglas-Peucker simplification, Future Solana settlement, Generated world map, Hypothesis lanes, Information coefficient hit test (+20 more)

### Community 4 - "Workspace Package Scripts"
Cohesion: 0.08
Nodes (25): concurrently, dependencies, concurrently, express, react, react-dom, react-router-dom, express (+17 more)

### Community 5 - "Browser TypeScript Config"
Cohesion: 0.08
Nodes (23): DOM, src, vite/client, compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx (+15 more)

### Community 6 - "Brand Asset Extraction"
Cohesion: 0.21
Nodes (19): Image, Namespace, Path, add_origin(), build_alpha(), contrast_delta(), expand_bbox(), extract_variant() (+11 more)

### Community 7 - "Server TypeScript Config"
Cohesion: 0.10
Nodes (19): node, vite.config.ts, compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection (+11 more)

### Community 8 - "Frontend Dependencies"
Cohesion: 0.11
Nodes (19): oxlint, devDependencies, oxlint, topojson-client, @types/node, @types/react, @types/react-dom, typescript (+11 more)

### Community 9 - "World Map Pipeline"
Cohesion: 0.14
Nodes (13): borderLines, borders, cleanRing(), kept, land, landPolygons, polys(), ring() (+5 more)

### Community 10 - "QARAU Brand Assets"
Cohesion: 0.31
Nodes (10): QARAU Apple touch icon, QARAU 32-pixel favicon, QARAU 48-pixel favicon, QARAU mark on dark background, Striped wave bridge motif, QARAU stylized Q monogram on dark background, QARAU brand identity, QARAU primary lockup on dark background (+2 more)

### Community 11 - "Server Package"
Cohesion: 0.20
Nodes (9): dependencies, express, express, name, private, scripts, start, type (+1 more)

### Community 12 - "Physical Data Mapping"
Cohesion: 0.27
Nodes (7): GapSite, ObservationField(), Site, TONE, BORDER_LINES, LAND_POLYGONS, Ring

### Community 13 - "Application Entry"
Cohesion: 0.25
Nodes (9): Dark colour scheme, Google Fonts, IBM Plex Mono typeface, Inter typeface, Private research authorized access, Qarau / Internal, Qarau HTML entry document, React root (+1 more)

### Community 14 - "Lint Configuration"
Cohesion: 0.22
Nodes (8): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, oxc, typescript, warn

### Community 15 - "Owner Authentication UI"
Cohesion: 0.25
Nodes (8): Authenticate action, Qarau owner authentication screen, Dark minimal high-contrast interface, Owner-only access panel, Owner credential input, Private market signals, Qarau brand mark, Restrict private signals to the owner

### Community 16 - "Social Icon Sprite"
Cohesion: 0.43
Nodes (8): Bluesky icon, Discord icon, Developer documentation icon, GitHub icon, Interface icon symbol sprite, Social and developer navigation, Social profile badge icon, X social network icon

### Community 17 - "Hero System Visual"
Cohesion: 0.60
Nodes (5): Layered hero graphic, Layered system metaphor, Lower purple-accented rounded layer, Upper outlined rounded layer, Vertical dashed layer connectors

### Community 18 - "Playwright Snapshot"
Cohesion: 0.67
Nodes (3): Playwright page snapshot, Qarau, Session verification

## Knowledge Gaps
- **151 isolated node(s):** `$schema`, `typescript`, `oxc`, `react/rules-of-hooks`, `warn` (+146 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Frontend and API` to `UI Visualization Components`, `Physical Data Mapping`, `Lint Configuration`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `plugins` connect `Lint Configuration` to `Frontend and API`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `Frontend Dependencies` to `Workspace Package Scripts`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `$schema`, `typescript`, `oxc` to the rest of the system?**
  _151 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Frontend and API` be split into smaller, more focused modules?**
  _Cohesion score 0.07043650793650794 - nodes in this community are weakly interconnected._
- **Should `UI Visualization Components` be split into smaller, more focused modules?**
  _Cohesion score 0.10404040404040404 - nodes in this community are weakly interconnected._
- **Should `Authentication and Sessions` be split into smaller, more focused modules?**
  _Cohesion score 0.09024390243902439 - nodes in this community are weakly interconnected._
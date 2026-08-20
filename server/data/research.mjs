/* ============================================================
   PROPRIETARY RESEARCH DATA

   This module is the reason the server exists. None of it is
   importable from the frontend, none of it is in the client
   bundle, and every route that reads it sits behind
   requireOwner(). Simulated throughout.
   ============================================================ */

/** Lifecycle. A discovered signal is never permanently solved. */
export const STATUSES = ["CANDIDATE", "ACTIVE", "WATCHLIST", "DEGRADING", "RETIRED", "REJECTED"];

export const DATASETS = [
  {
    id: "0182",
    name: "German Industrial Power Demand",
    category: "Energy",
    sourceType: "PUBLIC",
    region: "DE",
    frequency: "60M",
    historyYears: 6.2,
    quality: 94,
    site: { city: "Berlin", country: "DE", lat: 52.52, lon: 13.405 },
    coverage: "reporting",
  },
  {
    id: "0184",
    name: "Taiwan Fab Cluster Power Draw",
    category: "Energy",
    sourceType: "LICENSED",
    region: "TW",
    frequency: "60M",
    historyYears: 8.0,
    quality: 91,
    site: { city: "Hsinchu", country: "TW", lat: 24.7737, lon: 120.9977 },
    coverage: "reporting",
  },
  {
    id: "0186",
    name: "California Grid Load",
    category: "Energy",
    sourceType: "PUBLIC",
    region: "US",
    frequency: "60M",
    historyYears: 7.0,
    quality: 96,
    site: { city: "Fremont", country: "US", lat: 37.4848, lon: -121.9886 },
    coverage: "reporting",
  },
  {
    id: "0191",
    name: "Rotterdam Port Activity",
    category: "Ports",
    sourceType: "DERIVED",
    region: "NL",
    frequency: "15M",
    historyYears: 9.1,
    quality: 89,
    site: { city: "Rotterdam", country: "NL", lat: 51.9244, lon: 4.4777 },
    coverage: "reporting",
  },
  {
    id: "0194",
    name: "Strait of Hormuz Transit Density",
    category: "Ports",
    sourceType: "DERIVED",
    region: "OM",
    frequency: "15M",
    historyYears: 9.1,
    quality: 86,
    site: { city: "Hormuz", country: "OM", lat: 26.5667, lon: 56.25 },
    coverage: "reporting",
  },
  {
    id: "0197",
    name: "Gulf Coast Refinery Thermal Output",
    category: "Industry",
    sourceType: "PUBLIC",
    region: "US",
    frequency: "12H",
    historyYears: 10.4,
    quality: 88,
    site: { city: "Baytown", country: "US", lat: 29.7355, lon: -94.9774 },
    coverage: "reporting",
  },
  {
    id: "0201",
    name: "Datacenter Cooling Water Withdrawal",
    category: "Industry",
    sourceType: "PUBLIC",
    region: "US",
    frequency: "24H",
    historyYears: 6.8,
    quality: 83,
    site: { city: "Ashburn", country: "US", lat: 39.0438, lon: -77.4874 },
    coverage: "reporting",
  },
  {
    id: "0206",
    name: "Rhine Water Level at Kaub",
    category: "Weather",
    sourceType: "PUBLIC",
    region: "DE",
    frequency: "15M",
    historyYears: 14.6,
    quality: 97,
    site: { city: "Kaub", country: "DE", lat: 50.0855, lon: 7.7648 },
    coverage: "reporting",
  },
  {
    id: "0209",
    name: "Fremont Outbound Vehicle Logistics",
    category: "Mobility",
    sourceType: "LICENSED",
    region: "US",
    frequency: "24H",
    historyYears: 5.4,
    quality: 79,
    site: { city: "Fremont", country: "US", lat: 37.4931, lon: -121.9447 },
    coverage: "reporting",
  },
  {
    id: "0212",
    name: "Shanghai Outbound Ro-Ro Departures",
    category: "Ports",
    sourceType: "DERIVED",
    region: "CN",
    frequency: "15M",
    historyYears: 6.9,
    quality: 81,
    site: { city: "Shanghai", country: "CN", lat: 30.6266, lon: 122.0645 },
    coverage: "reporting",
  },
  {
    id: "0218",
    name: "US Interstate Traffic Volume",
    category: "Traffic",
    sourceType: "PUBLIC",
    region: "US",
    frequency: "60M",
    historyYears: 11.2,
    quality: 92,
    site: { city: "Houston", country: "US", lat: 29.7604, lon: -95.3698 },
    coverage: "reporting",
  },
  {
    id: "0224",
    name: "Air Freight Capacity TPE—SJC",
    category: "Flights",
    sourceType: "DERIVED",
    region: "TW",
    frequency: "24H",
    historyYears: 5.9,
    quality: 74,
    site: { city: "Taipei", country: "TW", lat: 25.0797, lon: 121.2342 },
    coverage: "reporting",
  },
  {
    id: "0231",
    name: "London Retail Footfall",
    category: "Retail",
    sourceType: "LICENSED",
    region: "GB",
    frequency: "60M",
    historyYears: 4.2,
    quality: 68,
    site: { city: "London", country: "GB", lat: 51.5074, lon: -0.1278 },
    coverage: "historical",
  },
  {
    id: "0237",
    name: "Tokyo Rail Ridership",
    category: "Mobility",
    sourceType: "PUBLIC",
    region: "JP",
    frequency: "24H",
    historyYears: 7.7,
    quality: 85,
    site: { city: "Tokyo", country: "JP", lat: 35.6895, lon: 139.6917 },
    coverage: "historical",
  },
  {
    id: "0242",
    name: "ERCOT Datacenter Power Draw",
    category: "Energy",
    sourceType: "PUBLIC",
    region: "US",
    frequency: "15M",
    historyYears: 5.1,
    quality: 87,
    site: { city: "Rockdale", country: "US", lat: 30.6549, lon: -97.0011 },
    coverage: "historical",
  },
  {
    id: "0248",
    name: "Dampier Ore Loading Cycles",
    category: "Ports",
    sourceType: "DERIVED",
    region: "AU",
    frequency: "12H",
    historyYears: 8.3,
    quality: 77,
    site: { city: "Dampier", country: "AU", lat: -20.6626, lon: 116.7137 },
    coverage: "historical",
  },
];

/* ------------------------------------------------------------
   SIGNALS — the private inventory.
   ------------------------------------------------------------ */

function signal(s) {
  return {
    direction: "POSITIVE",
    validationWindow: "2019.01 — 2026.06",
    ...s,
  };
}

export const SIGNALS = [
  signal({
    id: "0041",
    status: "ACTIVE",
    name: "German Industrial Power Demand",
    datasetId: "0182",
    target: "BAS.DE",
    targetName: "BASF",
    bestLag: 2,
    thesis:
      "Acceleration in German industrial electricity demand appears to contain predictive information relevant to BASF returns at approximately a two-day lead.",
    hypothesis:
      "Industrial power consumption may act as a higher-frequency proxy for manufacturing activity before conventional reporting reflects the change.",
    ic: 0.083,
    oosIc: 0.071,
    oosPassed: true,
    sharpeBefore: 0.74,
    sharpeAfter: 1.16,
    returnBefore: 11.2,
    returnAfter: 15.8,
    ddBefore: -18.4,
    ddAfter: -14.1,
    health: { stability: 87, decay: 12, crowding: "LOW", dataQuality: 94, regimeRobustness: 81 },
    lastValidatedHoursAgo: 18,
    created: "2026.02.14",
    notes:
      "Holds through the 2024 energy-price dislocation with reduced but positive IC. Watch for substitution to gas-fired capacity, which would break the proxy.",
    regimes: [
      { label: "Low volatility", ic: 0.086, held: true },
      { label: "High volatility", ic: 0.074, held: true },
      { label: "Rising rates", ic: 0.081, held: true },
      { label: "Drawdown", ic: 0.062, held: true },
    ],
    seed: 1017,
  }),
  signal({
    id: "0038",
    status: "ACTIVE",
    name: "Taiwan Fab Cluster Power Draw",
    datasetId: "0184",
    target: "NVDA",
    targetName: "NVIDIA",
    bestLag: 4,
    thesis:
      "Grid draw around the Hsinchu fabrication cluster carries information about NVIDIA returns at roughly a four-day lead.",
    hypothesis:
      "Advanced fabrication is power intensive, so cluster load may track wafer starts, which sit upstream of anything the market eventually sees in reported revenue.",
    ic: 0.088,
    oosIc: 0.079,
    oosPassed: true,
    sharpeBefore: 0.93,
    sharpeAfter: 1.28,
    returnBefore: 18.2,
    returnAfter: 24.1,
    ddBefore: -26.4,
    ddAfter: -20.9,
    health: { stability: 91, decay: 8, crowding: "LOW", dataQuality: 91, regimeRobustness: 86 },
    lastValidatedHoursAgo: 6,
    created: "2026.01.09",
    notes:
      "Strongest signal in the inventory. Dependency is single-source and licensed; loss of the feed retires the signal immediately.",
    regimes: [
      { label: "Low volatility", ic: 0.091, held: true },
      { label: "High volatility", ic: 0.079, held: true },
      { label: "Rising rates", ic: 0.084, held: true },
      { label: "Drawdown", ic: 0.066, held: true },
    ],
    seed: 2201,
  }),
  signal({
    id: "0044",
    status: "ACTIVE",
    name: "Gulf Coast Refinery Thermal Output",
    datasetId: "0197",
    target: "XOM",
    targetName: "Exxon Mobil",
    bestLag: 5,
    thesis:
      "Nightly thermal composites over Gulf Coast refining capacity lead Exxon returns by about five days.",
    hypothesis:
      "Refineries run hot or they do not run, so thermal output is a direct read on throughput that does not depend on operator disclosure.",
    ic: 0.081,
    oosIc: 0.069,
    oosPassed: true,
    sharpeBefore: 0.62,
    sharpeAfter: 0.99,
    returnBefore: 9.8,
    returnAfter: 14.2,
    ddBefore: -22.7,
    ddAfter: -17.9,
    health: { stability: 83, decay: 17, crowding: "MODERATE", dataQuality: 88, regimeRobustness: 78 },
    lastValidatedHoursAgo: 30,
    created: "2025.11.22",
    notes:
      "Satellite thermal products are increasingly commercialised. Crowding heuristic raised to moderate on that basis, not on observed decay.",
    regimes: [
      { label: "Low volatility", ic: 0.084, held: true },
      { label: "High volatility", ic: 0.072, held: true },
      { label: "Rising rates", ic: 0.079, held: true },
      { label: "Drawdown", ic: 0.058, held: true },
    ],
    seed: 3301,
  }),
  signal({
    id: "0047",
    status: "ACTIVE",
    name: "Rotterdam Port Activity",
    datasetId: "0191",
    target: "BRENT",
    targetName: "Brent Crude",
    bestLag: 8,
    thesis:
      "Berth occupancy and laden departures at Rotterdam lead Brent by roughly eight days.",
    hypothesis:
      "Rotterdam is the primary European entry point for crude and products, so physical flow there may register before published inventory data.",
    ic: 0.076,
    oosIc: 0.064,
    oosPassed: true,
    sharpeBefore: 0.91,
    sharpeAfter: 1.08,
    returnBefore: 13.6,
    returnAfter: 16.9,
    ddBefore: -24.2,
    ddAfter: -20.4,
    health: { stability: 82, decay: 19, crowding: "MODERATE", dataQuality: 89, regimeRobustness: 75 },
    lastValidatedHoursAgo: 42,
    created: "2025.09.30",
    notes: "AIS-derived. Several vendors sell comparable products, so assume limited exclusivity.",
    regimes: [
      { label: "Low volatility", ic: 0.079, held: true },
      { label: "High volatility", ic: 0.068, held: true },
      { label: "Rising rates", ic: 0.073, held: true },
      { label: "Drawdown", ic: 0.055, held: true },
    ],
    seed: 4401,
  }),
  signal({
    id: "0052",
    status: "ACTIVE",
    name: "Fremont Outbound Vehicle Logistics",
    datasetId: "0209",
    target: "TSLA",
    targetName: "Tesla",
    bestLag: 5,
    thesis:
      "Outbound car-carrier departures from Fremont lead Tesla returns by about five days.",
    hypothesis:
      "Carrier departures count finished units physically leaving the plant, which is observable before delivery figures are published.",
    ic: 0.068,
    oosIc: 0.057,
    oosPassed: true,
    sharpeBefore: 0.81,
    sharpeAfter: 1.06,
    returnBefore: 12.4,
    returnAfter: 15.2,
    ddBefore: -19.1,
    ddAfter: -16.3,
    health: { stability: 79, decay: 21, crowding: "LOW", dataQuality: 79, regimeRobustness: 72 },
    lastValidatedHoursAgo: 12,
    created: "2026.03.02",
    notes: "Data quality is the weak point — collection gaps around holidays require interpolation.",
    regimes: [
      { label: "Low volatility", ic: 0.071, held: true },
      { label: "High volatility", ic: 0.059, held: true },
      { label: "Rising rates", ic: 0.063, held: true },
      { label: "Drawdown", ic: 0.041, held: true },
    ],
    seed: 1188,
  }),
  signal({
    id: "0055",
    status: "ACTIVE",
    name: "Datacenter Cooling Water Withdrawal",
    datasetId: "0201",
    target: "NVDA",
    targetName: "NVIDIA",
    bestLag: 6,
    thesis:
      "Cooling withdrawal across Northern Virginia datacenter capacity leads NVIDIA returns by about six days.",
    hypothesis:
      "Cooling load scales with compute actually running rather than compute purchased, giving a read on utilisation independent of vendor disclosure.",
    ic: 0.074,
    oosIc: 0.061,
    oosPassed: true,
    sharpeBefore: 0.93,
    sharpeAfter: 1.19,
    returnBefore: 18.2,
    returnAfter: 22.4,
    ddBefore: -26.4,
    ddAfter: -22.6,
    health: { stability: 81, decay: 15, crowding: "LOW", dataQuality: 83, regimeRobustness: 77 },
    lastValidatedHoursAgo: 26,
    created: "2026.01.28",
    notes: "Correlated with SIG/0038. Combined allocation should account for shared exposure.",
    regimes: [
      { label: "Low volatility", ic: 0.078, held: true },
      { label: "High volatility", ic: 0.061, held: true },
      { label: "Rising rates", ic: 0.072, held: true },
      { label: "Drawdown", ic: 0.049, held: true },
    ],
    seed: 2388,
  }),
  signal({
    id: "0058",
    status: "ACTIVE",
    name: "Rhine Water Level at Kaub",
    datasetId: "0206",
    target: "BAS.DE",
    targetName: "BASF",
    bestLag: 4,
    thesis:
      "The Kaub gauge leads BASF returns by roughly four days, with the relationship concentrated in periods near the loading threshold.",
    hypothesis:
      "Barge draft on the Rhine sets feedstock transport cost. Below the loading threshold freight reroutes to rail at materially higher cost.",
    direction: "NEGATIVE",
    ic: 0.061,
    oosIc: 0.052,
    oosPassed: true,
    sharpeBefore: 0.74,
    sharpeAfter: 1.02,
    returnBefore: 11.2,
    returnAfter: 13.9,
    ddBefore: -18.4,
    ddAfter: -16.0,
    health: { stability: 77, decay: 23, crowding: "LOW", dataQuality: 97, regimeRobustness: 69 },
    lastValidatedHoursAgo: 20,
    created: "2025.08.11",
    notes:
      "Conditional rather than linear: most of the effect sits in the lower tail. Modelled with a threshold term.",
    regimes: [
      { label: "Low volatility", ic: 0.064, held: true },
      { label: "High volatility", ic: 0.053, held: true },
      { label: "Rising rates", ic: 0.058, held: true },
      { label: "Drawdown", ic: 0.039, held: true },
    ],
    seed: 2244,
  }),

  signal({
    id: "0061",
    status: "WATCHLIST",
    name: "Shanghai Outbound Ro-Ro Departures",
    datasetId: "0212",
    target: "TSLA",
    targetName: "Tesla",
    bestLag: 8,
    thesis:
      "Laden vehicle-carrier departures from Shanghai show a weak but persistent lead on Tesla returns.",
    hypothesis:
      "Counting laden departures gives an early read on export volume, though the long lead admits more intervening noise.",
    ic: 0.052,
    oosIc: 0.038,
    oosPassed: true,
    sharpeBefore: 0.81,
    sharpeAfter: 0.98,
    returnBefore: 12.4,
    returnAfter: 14.1,
    ddBefore: -19.1,
    ddAfter: -17.4,
    health: { stability: 71, decay: 28, crowding: "MODERATE", dataQuality: 81, regimeRobustness: 58 },
    lastValidatedHoursAgo: 54,
    created: "2026.04.19",
    notes: "Fails the drawdown regime. Held on watchlist rather than allocated.",
    regimes: [
      { label: "Low volatility", ic: 0.058, held: true },
      { label: "High volatility", ic: 0.044, held: true },
      { label: "Rising rates", ic: 0.049, held: true },
      { label: "Drawdown", ic: 0.028, held: false },
    ],
    seed: 1342,
  }),
  signal({
    id: "0064",
    status: "WATCHLIST",
    name: "Strait of Hormuz Transit Density",
    datasetId: "0194",
    target: "BRENT",
    targetName: "Brent Crude",
    bestLag: 6,
    thesis: "Transit counts through the strait lead Brent by about six days.",
    hypothesis:
      "A large share of seaborne crude passes through one corridor, so transit counts measure supply in motion rather than supply announced.",
    ic: 0.07,
    oosIc: 0.049,
    oosPassed: true,
    sharpeBefore: 0.91,
    sharpeAfter: 1.04,
    returnBefore: 13.6,
    returnAfter: 16.1,
    ddBefore: -24.2,
    ddAfter: -21.3,
    health: { stability: 74, decay: 26, crowding: "HIGH", dataQuality: 86, regimeRobustness: 64 },
    lastValidatedHoursAgo: 66,
    created: "2025.12.05",
    notes:
      "Widely watched corridor — crowding heuristic is high. Kept for research value, not allocated.",
    regimes: [
      { label: "Low volatility", ic: 0.072, held: true },
      { label: "High volatility", ic: 0.066, held: true },
      { label: "Rising rates", ic: 0.068, held: true },
      { label: "Drawdown", ic: 0.051, held: true },
    ],
    seed: 4588,
  }),
  signal({
    id: "0067",
    status: "WATCHLIST",
    name: "US Interstate Traffic Volume",
    datasetId: "0218",
    target: "XOM",
    targetName: "Exxon Mobil",
    bestLag: 2,
    thesis: "Interstate vehicle miles lead Exxon returns by roughly two days.",
    hypothesis:
      "Vehicle miles travelled is the demand side of refined product, counted at the roadside ahead of weekly inventory statistics.",
    ic: 0.057,
    oosIc: 0.041,
    oosPassed: true,
    sharpeBefore: 0.62,
    sharpeAfter: 0.84,
    returnBefore: 9.8,
    returnAfter: 12.3,
    ddBefore: -22.7,
    ddAfter: -20.1,
    health: { stability: 74, decay: 24, crowding: "HIGH", dataQuality: 92, regimeRobustness: 66 },
    lastValidatedHoursAgo: 38,
    created: "2025.10.14",
    notes: "Public dataset, widely followed. Assume little informational edge remains.",
    regimes: [
      { label: "Low volatility", ic: 0.061, held: true },
      { label: "High volatility", ic: 0.048, held: true },
      { label: "Rising rates", ic: 0.055, held: true },
      { label: "Drawdown", ic: 0.033, held: true },
    ],
    seed: 3466,
  }),
  signal({
    id: "0070",
    status: "WATCHLIST",
    name: "Air Freight Capacity TPE—SJC",
    datasetId: "0224",
    target: "NVDA",
    targetName: "NVIDIA",
    bestLag: 3,
    thesis: "Booked freight capacity on the Taipei—San Jose lane shows a short lead on NVIDIA returns.",
    hypothesis:
      "High-value silicon moves by air, so booked capacity on the primary lane may lead shipment recognition. The lane carries many other goods.",
    ic: 0.049,
    oosIc: 0.031,
    oosPassed: true,
    sharpeBefore: 0.93,
    sharpeAfter: 1.05,
    returnBefore: 18.2,
    returnAfter: 20.1,
    ddBefore: -26.4,
    ddAfter: -24.8,
    health: { stability: 68, decay: 34, crowding: "LOW", dataQuality: 74, regimeRobustness: 55 },
    lastValidatedHoursAgo: 72,
    created: "2026.05.07",
    notes: "Weakest surviving candidate. Data quality is the binding constraint.",
    regimes: [
      { label: "Low volatility", ic: 0.054, held: true },
      { label: "High volatility", ic: 0.038, held: true },
      { label: "Rising rates", ic: 0.046, held: true },
      { label: "Drawdown", ic: 0.021, held: false },
    ],
    seed: 2477,
  }),

  signal({
    id: "0029",
    status: "DEGRADING",
    name: "London Retail Footfall",
    datasetId: "0231",
    target: "BRENT",
    targetName: "Brent Crude",
    bestLag: 3,
    thesis:
      "Footfall previously led consumption-linked returns by about three days. The relationship has weakened materially since 2025.",
    hypothesis:
      "Retail presence was a proxy for discretionary activity. Panel composition changes appear to have broken the proxy.",
    ic: 0.044,
    oosIc: 0.012,
    oosPassed: false,
    sharpeBefore: 0.91,
    sharpeAfter: 0.94,
    returnBefore: 13.6,
    returnAfter: 14.0,
    ddBefore: -24.2,
    ddAfter: -23.8,
    health: { stability: 41, decay: 74, crowding: "MODERATE", dataQuality: 68, regimeRobustness: 33 },
    lastValidatedHoursAgo: 8,
    created: "2025.03.18",
    notes:
      "Rolling IC has trended toward zero for three quarters. Scheduled for retirement unless the vendor explains the panel change.",
    regimes: [
      { label: "Low volatility", ic: 0.048, held: true },
      { label: "High volatility", ic: 0.019, held: false },
      { label: "Rising rates", ic: 0.022, held: false },
      { label: "Drawdown", ic: 0.004, held: false },
    ],
    seed: 5501,
  }),
  signal({
    id: "0033",
    status: "DEGRADING",
    name: "ERCOT Datacenter Power Draw",
    datasetId: "0242",
    target: "BTC",
    targetName: "Bitcoin",
    bestLag: 3,
    thesis:
      "Interruptible load behaviour in Texas led Bitcoin returns by about three days. The effect has halved since curtailment rules changed.",
    hypothesis:
      "Large interruptible loads correlate with mining activity, so curtailment behaviour was observable before it reached network statistics.",
    ic: 0.055,
    oosIc: 0.023,
    oosPassed: false,
    sharpeBefore: 0.54,
    sharpeAfter: 0.61,
    returnBefore: 22.1,
    returnAfter: 24.0,
    ddBefore: -48.3,
    ddAfter: -47.1,
    health: { stability: 48, decay: 68, crowding: "MODERATE", dataQuality: 87, regimeRobustness: 39 },
    lastValidatedHoursAgo: 14,
    created: "2025.06.02",
    notes: "Regime change is structural, not statistical. Unlikely to recover.",
    regimes: [
      { label: "Low volatility", ic: 0.059, held: true },
      { label: "High volatility", ic: 0.024, held: false },
      { label: "Rising rates", ic: 0.031, held: false },
      { label: "Drawdown", ic: 0.011, held: false },
    ],
    seed: 5644,
  }),

  signal({
    id: "0016",
    status: "RETIRED",
    name: "Dampier Ore Loading Cycles",
    datasetId: "0248",
    target: "BRENT",
    targetName: "Brent Crude",
    bestLag: 9,
    thesis:
      "Loading cycle counts led bulk-linked returns until 2025, when the relationship collapsed.",
    hypothesis:
      "Loading cadence was a proxy for bulk demand. The proxy did not survive a shift in shipping contract structure.",
    ic: 0.038,
    oosIc: -0.004,
    oosPassed: false,
    sharpeBefore: 0.91,
    sharpeAfter: 0.89,
    returnBefore: 13.6,
    returnAfter: 13.4,
    ddBefore: -24.2,
    ddAfter: -24.6,
    health: { stability: 22, decay: 96, crowding: "LOW", dataQuality: 77, regimeRobustness: 18 },
    lastValidatedHoursAgo: 2160,
    created: "2024.11.03",
    notes: "Retired 2026.04. Kept in inventory as negative research.",
    regimes: [
      { label: "Low volatility", ic: 0.014, held: false },
      { label: "High volatility", ic: -0.002, held: false },
      { label: "Rising rates", ic: 0.006, held: false },
      { label: "Drawdown", ic: -0.011, held: false },
    ],
    seed: 6602,
  }),
];

/* ------------------------------------------------------------
   RUNS — the experiment log, failures included.
   ------------------------------------------------------------ */

export const RUNS = [
  {
    id: "0184",
    target: "BAS.DE",
    horizon: "3D",
    universe: "ALL AVAILABLE",
    date: "2026.08.19",
    status: "COMPLETE",
    funnel: {
      datasets: 127,
      features: 684,
      tested: 8412,
      passedFilters: 91,
      passedRobustness: 14,
      passedOOS: 3,
      candidates: 1,
    },
    producedSignalIds: ["0041"],
    rejected: [
      { name: "Frankfurt Air Quality Index", reason: "Relationship does not remain stable outside the discovery period.", stage: "OUT-OF-SAMPLE" },
      { name: "Eurozone PMI Surveys", reason: "Already reflected in price by publication.", stage: "ROBUSTNESS" },
      { name: "Benelux Rail Freight Tonnage", reason: "Explained by the sector benchmark once controlled.", stage: "ROBUSTNESS" },
    ],
  },
  {
    id: "0181",
    target: "NVDA",
    horizon: "7D",
    universe: "ALL AVAILABLE",
    date: "2026.08.12",
    status: "COMPLETE",
    funnel: {
      datasets: 127,
      features: 702,
      tested: 8914,
      passedFilters: 104,
      passedRobustness: 21,
      passedOOS: 4,
      candidates: 2,
    },
    producedSignalIds: ["0038", "0055"],
    rejected: [
      { name: "Global Cloud Outage Reports", reason: "Relationship does not remain stable outside the discovery period.", stage: "OUT-OF-SAMPLE" },
      { name: "Consumer GPU Retail Pricing", reason: "Explained by sector beta once controlled.", stage: "ROBUSTNESS" },
    ],
  },
  {
    id: "0178",
    target: "XOM",
    horizon: "7D",
    universe: "ENERGY + INDUSTRY",
    date: "2026.07.28",
    status: "COMPLETE",
    funnel: {
      datasets: 64,
      features: 388,
      tested: 4106,
      passedFilters: 58,
      passedRobustness: 11,
      passedOOS: 2,
      candidates: 1,
    },
    producedSignalIds: ["0044"],
    rejected: [
      { name: "Retail Fuel Prices", reason: "Coincident rather than leading. No exploitable lead remains.", stage: "INITIAL" },
      { name: "Hurricane Track Forecasts", reason: "Unstable across regimes and rarely observed.", stage: "ROBUSTNESS" },
    ],
  },
  {
    id: "0172",
    target: "NVDA",
    horizon: "1D",
    universe: "WEATHER",
    date: "2026.07.02",
    status: "REJECTED",
    funnel: {
      datasets: 22,
      features: 141,
      tested: 1684,
      passedFilters: 19,
      passedRobustness: 3,
      passedOOS: 0,
      candidates: 0,
    },
    producedSignalIds: [],
    rejected: [
      { name: "New York Temperature", reason: "Relationship does not remain stable outside the discovery period.", stage: "OUT-OF-SAMPLE" },
      { name: "Bay Area Precipitation", reason: "In-sample result did not survive walk-forward validation.", stage: "OUT-OF-SAMPLE" },
      { name: "Taipei Humidity", reason: "Effect size within noise once multiple testing is accounted for.", stage: "ROBUSTNESS" },
    ],
    note: "Whole-universe rejection. Weather alone produced nothing usable for this target.",
  },
  {
    id: "0169",
    target: "BTC",
    horizon: "3D",
    universe: "ALL AVAILABLE",
    date: "2026.06.15",
    status: "COMPLETE",
    funnel: {
      datasets: 127,
      features: 651,
      tested: 7908,
      passedFilters: 62,
      passedRobustness: 11,
      passedOOS: 1,
      candidates: 1,
    },
    producedSignalIds: ["0033"],
    rejected: [
      { name: "Social Media Mention Volume", reason: "Relationship does not remain stable outside the discovery period.", stage: "OUT-OF-SAMPLE" },
      { name: "Exchange Web Traffic", reason: "Coincident with price. No usable lead.", stage: "INITIAL" },
    ],
  },
  {
    id: "0166",
    target: "BAS.DE",
    horizon: "14D",
    universe: "ALL AVAILABLE",
    date: "2026.05.30",
    status: "REJECTED",
    funnel: {
      datasets: 127,
      features: 684,
      tested: 8412,
      passedFilters: 44,
      passedRobustness: 5,
      passedOOS: 0,
      candidates: 0,
    },
    producedSignalIds: [],
    rejected: [
      { name: "German Industrial Power Demand", reason: "Signal exists at short horizons only. Nothing survives at 14 days.", stage: "OUT-OF-SAMPLE" },
    ],
    note: "Horizon sweep. Confirms the SIG/0041 relationship is short-lead and does not extend.",
  },
];

/* ------------------------------------------------------------
   COVERAGE GAPS
   The hypothesis is deliberately withheld: a contributor needs
   to know what to measure, never why it is wanted.
   ------------------------------------------------------------ */

export const GAPS = [
  {
    id: "0191",
    observation: "Semiconductor Factory Footfall",
    region: "HSINCHU / TW",
    site: { city: "Hsinchu", country: "TW", lat: 24.7737, lon: 120.9977 },
    desiredFrequency: "15 MIN",
    category: "Mobility",
    researchValue: "HIGH",
    status: "NO DATA SOURCE",
    internalNote:
      "Shift-change density would reveal capacity constraint days before it reaches production figures.",
  },
  {
    id: "0196",
    observation: "Substrate Packaging Line Throughput",
    region: "PENANG / MY",
    site: { city: "Penang", country: "MY", lat: 5.4164, lon: 100.3327 },
    desiredFrequency: "1 HR",
    category: "Industry",
    researchValue: "HIGH",
    status: "NO DATA SOURCE",
    internalNote: "Packaging is the known bottleneck. Nothing measures it at daily resolution.",
  },
  {
    id: "0203",
    observation: "Rail Siding Wagon Counts",
    region: "LUDWIGSHAFEN / DE",
    site: { city: "Ludwigshafen", country: "DE", lat: 49.4875, lon: 8.4661 },
    desiredFrequency: "1 HR",
    category: "Traffic",
    researchValue: "HIGH",
    status: "NO DATA SOURCE",
    internalNote: "Rail substitution is the response to low Rhine water. Would sharpen SIG/0058.",
  },
  {
    id: "0208",
    observation: "Terminal Loading Counts",
    region: "BONNY / NG",
    site: { city: "Bonny", country: "NG", lat: 4.4515, lon: 7.1698 },
    desiredFrequency: "12 HR",
    category: "Ports",
    researchValue: "MODERATE",
    status: "INSUFFICIENT QUALITY",
    internalNote: "Reported monthly at best. Daily observation would close a visible gap.",
  },
  {
    id: "0214",
    observation: "Refinery Turnaround Crew Movements",
    region: "BAYTOWN / US",
    site: { city: "Baytown", country: "US", lat: 29.7355, lon: -94.9774 },
    desiredFrequency: "24 HR",
    category: "Mobility",
    researchValue: "MODERATE",
    status: "NO DATA SOURCE",
    internalNote: "Maintenance shutdowns are scheduled privately. Crew presence would reveal them early.",
  },
];

/* ------------------------------------------------------------
   DERIVED VIEWS
   Counts are computed, never authored, so a headline figure can
   never disagree with the list underneath it.
   ------------------------------------------------------------ */

export function inventoryStats() {
  const byStatus = {};
  for (const s of STATUSES) byStatus[s] = 0;
  for (const s of SIGNALS) byStatus[s.status] += 1;

  // Hypotheses that reached robustness testing and died there or later.
  const rejectedTotal = RUNS.reduce(
    (n, r) => n + (r.funnel.passedFilters - r.funnel.candidates),
    0,
  );

  return {
    active: byStatus.ACTIVE,
    watchlist: byStatus.WATCHLIST,
    degrading: byStatus.DEGRADING,
    retired: byStatus.RETIRED,
    candidate: byStatus.CANDIDATE,
    rejected: rejectedTotal,
    total: SIGNALS.length,
  };
}

/** List view: enough to triage, not the full research file. */
export function signalSummaries() {
  return SIGNALS.map((s) => ({
    id: s.id,
    status: s.status,
    name: s.name,
    target: s.target,
    bestLag: s.bestLag,
    oosPassed: s.oosPassed,
    sharpeBefore: s.sharpeBefore,
    sharpeAfter: s.sharpeAfter,
    stability: s.health.stability,
    decay: s.health.decay,
    crowding: s.health.crowding,
    lastValidatedHoursAgo: s.lastValidatedHoursAgo,
    ic: s.ic,
    seed: s.seed,
  }));
}

export function signalDetail(id) {
  const s = SIGNALS.find((x) => x.id === id);
  if (!s) return null;
  const dataset = DATASETS.find((d) => d.id === s.datasetId) ?? null;
  const runs = RUNS.filter((r) => r.producedSignalIds.includes(s.id)).map((r) => ({
    id: r.id,
    date: r.date,
    horizon: r.horizon,
  }));
  return { ...s, dataset, runs };
}

export function datasetViews() {
  return DATASETS.map((d) => {
    const linked = SIGNALS.filter((s) => s.datasetId === d.id);
    return {
      ...d,
      activeSignals: linked.filter((s) => s.status === "ACTIVE").length,
      candidates: linked.filter((s) => s.status === "WATCHLIST" || s.status === "CANDIDATE").length,
      linkedSignalIds: linked.map((s) => s.id),
    };
  });
}

export function runViews() {
  return RUNS.map((r) => ({ ...r, survivors: r.producedSignalIds.length }));
}

/* ------------------------------------------------------------
   RUN LANES

   One lane per hypothesis in the funnel diagram. These are a
   readable SAMPLE of the run, not the full population: a run
   tests thousands of relationships and no diagram shows that
   many. The real counts stay on the funnel readout beside it,
   and the interface says which is which.
   ------------------------------------------------------------ */

const STAGE_LABELS = [
  "HYPOTHESES",
  "INITIAL FILTERS",
  "ROBUSTNESS",
  "OUT-OF-SAMPLE",
  "PROPRIETARY",
];

const LANE_SAMPLE = 24;

/** Why a hypothesis died, by the stage that killed it. */
const REASONS = {
  1: [
    "Coincident with the target. No exploitable lead remains.",
    "Effect size within noise once multiple testing is accounted for.",
    "Coverage too sparse at the tested frequency.",
    "Already reflected in price by the time it is observable.",
  ],
  2: [
    "Explained by the sector benchmark once controlled.",
    "Unstable across volatility regimes.",
    "Result depends on a single sub-period.",
    "Sign flips under a small change of lag.",
  ],
  3: [
    "Relationship does not remain stable outside the discovery period.",
    "In-sample result did not survive walk-forward validation.",
    "Out-of-sample information coefficient indistinguishable from zero.",
  ],
  // Survived every statistical test and still was not taken. Selection is not
  // purely statistical, and the record should say so rather than implying
  // everything that validates gets allocated.
  4: [
    "Held out of sample, but too correlated with an existing signal to add anything.",
    "Held out of sample, but the uplift did not clear the allocation threshold.",
    "Held out of sample, but the data licence does not permit production use.",
  ],
};

/** Deterministic per run+lane, so a lane keeps its identity across requests. */
function laneRandom(runId, i) {
  let a = (Number(runId) * 7919 + i * 104729) >>> 0;
  a = (a ^ (a >>> 15)) * 2246822507;
  a = (a ^ (a >>> 13)) * 3266489909;
  return ((a ^ (a >>> 16)) >>> 0) / 4294967296;
}

export function runLanes(runId) {
  const run = RUNS.find((r) => r.id === runId);
  if (!run) return null;

  const survivors = run.producedSignalIds.length;
  // Strictly decreasing, and the final stage equals what the run actually
  // produced — the diagram can never disagree with the signal list.
  const counts = [LANE_SAMPLE, 12, 5, Math.max(survivors + 1, 2), survivors];

  // Surviving lanes get the datasets that really produced the signals.
  // A surviving lane IS the signal, so it inherits the signal's real numbers.
  // Generating its own would let the lane record contradict the research file
  // it links to.
  const survivorDatasets = run.producedSignalIds.map((id) => {
    const sig = SIGNALS.find((s) => s.id === id);
    return {
      datasetId: sig?.datasetId,
      signalId: id,
      ic: sig?.ic ?? 0.05,
      lag: sig?.bestLag ?? 3,
      stability: sig?.health.stability ?? 80,
      seed: sig?.seed,
    };
  });

  const pool = DATASETS.filter(
    (d) => !survivorDatasets.some((s) => s.datasetId === d.id),
  );

  const lanes = [];
  for (let i = 0; i < LANE_SAMPLE; i++) {
    let diedAt = null;
    for (let s = 1; s < counts.length; s++) {
      if (i >= counts[s]) {
        diedAt = s;
        break;
      }
    }

    const survived = diedAt === null;
    const surv = survived ? survivorDatasets[i] : null;
    const dataset = survived
      ? DATASETS.find((d) => d.id === surv?.datasetId) ?? pool[0]
      : pool[(i * 5 + Number(run.id)) % pool.length];

    const r = laneRandom(run.id, i);
    // Rank drives strength: lanes that go further tested stronger.
    const depth = survived ? counts.length - 1 : diedAt;
    const ic = survived
      ? surv?.ic ?? 0.06
      : Number((0.012 + depth * 0.016 + r * 0.014).toFixed(3));

    // Every terminated lane must carry a reason. A null here would surface as
    // an empty "why it was discarded" panel, which is worse than no panel.
    const reasonList = diedAt ? REASONS[diedAt] ?? REASONS[3] : null;

    lanes.push({
      id: `${run.id}-${String(i).padStart(2, "0")}`,
      rank: i,
      survived,
      diedAt,
      // The last column is an outcome, not a filter, so a lane stopping there
      // failed selection rather than "failing at PROPRIETARY".
      diedAtLabel:
        diedAt === null
          ? null
          : diedAt === STAGE_LABELS.length - 1
            ? "SELECTION"
            : STAGE_LABELS[diedAt],
      reachedStage: survived ? counts.length - 1 : diedAt,
      signalId: survived ? surv?.signalId ?? null : null,
      ic,
      lag: survived ? surv?.lag ?? 3 : 1 + Math.floor(r * 8),
      stability: survived ? surv?.stability ?? 80 : 24 + Math.floor(r * 34),
      reason: reasonList ? reasonList[i % reasonList.length] : null,
      // Survivors reuse the signal's seed so the lane's charts are the same
      // series the research file shows.
      seed: survived ? surv?.seed ?? Number(run.id) * 31 + i * 17 : Number(run.id) * 31 + i * 17,
      dataset: dataset
        ? {
            id: dataset.id,
            name: dataset.name,
            category: dataset.category,
            sourceType: dataset.sourceType,
            region: dataset.region,
            frequency: dataset.frequency,
            historyYears: dataset.historyYears,
            quality: dataset.quality,
            site: dataset.site,
            coverage: dataset.coverage,
          }
        : null,
    });
  }

  return {
    runId: run.id,
    target: run.target,
    stageLabels: STAGE_LABELS,
    stageCounts: counts,
    /** The diagram shows this many; the run tested far more. */
    sampled: LANE_SAMPLE,
    tested: run.funnel.tested,
    lanes,
  };
}

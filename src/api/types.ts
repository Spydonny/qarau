/**
 * Shapes only. Every value behind these types arrives from the authenticated
 * research API at runtime — none of it is compiled into this bundle.
 */

export type SignalStatus =
  | "CANDIDATE"
  | "ACTIVE"
  | "WATCHLIST"
  | "DEGRADING"
  | "RETIRED"
  | "REJECTED";

export type Crowding = "LOW" | "MODERATE" | "HIGH";

export type Session = {
  owner: { id: string };
  environment: string;
  issuedAt?: string;
};

export type SignalSummary = {
  id: string;
  status: SignalStatus;
  name: string;
  target: string;
  bestLag: number;
  oosPassed: boolean;
  sharpeBefore: number;
  sharpeAfter: number;
  stability: number;
  decay: number;
  crowding: Crowding;
  lastValidatedHoursAgo: number;
  ic: number;
  seed: number;
};

export type InventoryStats = {
  active: number;
  watchlist: number;
  degrading: number;
  retired: number;
  candidate: number;
  rejected: number;
  total: number;
};

export type Health = {
  stability: number;
  decay: number;
  crowding: Crowding;
  dataQuality: number;
  regimeRobustness: number;
};

export type Dataset = {
  id: string;
  name: string;
  category: string;
  sourceType: "PUBLIC" | "LICENSED" | "DERIVED";
  region: string;
  frequency: string;
  historyYears: number;
  quality: number;
  site: { city: string; country: string; lat: number; lon: number };
  coverage: "reporting" | "historical";
  activeSignals: number;
  candidates: number;
  linkedSignalIds: string[];
};

export type SignalDetail = SignalSummary & {
  datasetId: string;
  targetName: string;
  direction: "POSITIVE" | "NEGATIVE";
  validationWindow: string;
  thesis: string;
  hypothesis: string;
  oosIc: number;
  returnBefore: number;
  returnAfter: number;
  ddBefore: number;
  ddAfter: number;
  health: Health;
  created: string;
  notes: string;
  regimes: { label: string; ic: number; held: boolean }[];
  dataset: Dataset | null;
  runs: { id: string; date: string; horizon: string }[];
};

export type RunFunnel = {
  datasets: number;
  features: number;
  tested: number;
  passedFilters: number;
  passedRobustness: number;
  passedOOS: number;
  candidates: number;
};

export type Run = {
  id: string;
  target: string;
  horizon: string;
  universe: string;
  date: string;
  status: "COMPLETE" | "REJECTED";
  funnel: RunFunnel;
  producedSignalIds: string[];
  survivors: number;
  rejected: { name: string; reason: string; stage: string }[];
  note?: string;
  requestedAt?: string;
};

export type Gap = {
  id: string;
  observation: string;
  region: string;
  site: { city: string; country: string; lat: number; lon: number };
  desiredFrequency: string;
  category: string;
  researchValue: "HIGH" | "MODERATE" | "LOW";
  status: string;
  internalNote: string;
};

/** One hypothesis in a run's funnel diagram. */
export type Lane = {
  id: string;
  rank: number;
  survived: boolean;
  diedAt: number | null;
  diedAtLabel: string | null;
  reachedStage: number;
  signalId: string | null;
  ic: number;
  lag: number;
  stability: number;
  reason: string | null;
  seed: number;
  dataset: {
    id: string;
    name: string;
    category: string;
    sourceType: string;
    region: string;
    frequency: string;
    historyYears: number;
    quality: number;
    site: { city: string; country: string; lat: number; lon: number };
    coverage: string;
  } | null;
};

export type RunLanes = {
  runId: string;
  target: string;
  stageLabels: string[];
  stageCounts: number[];
  /** How many lanes the diagram draws; the run tested far more. */
  sampled: number;
  tested: number;
  lanes: Lane[];
};

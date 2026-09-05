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
  csrfToken?: string;
};

export type SignalSummary = {
  id: string;
  status: SignalStatus;
  name: string;
  target: string;
  bestLag: number;
  oosPassed: boolean;
  baselineR2: number;
  augmentedR2: number;
  stability: number;
  evidenceScore: number;
  sampleSize: number;
  correlation: number;
  warnings: string[];
  createdAt: string;
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
  catalog?: {
    newSources: number;
    totalRegistry: number;
    sourcesInScope: number;
    snapshotsReady: number;
    featuresReady: number;
    matchingTests: number;
  };
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

export type QarauSource = {
  id: string;
  publicId: string;
  name: string;
  provider: string;
  sourceType: string;
  category: string;
  industry: string;
  region: string;
  measurementDescription: string;
  spatialResolution: string;
  temporalResolution: string;
  updateFrequency: string;
  latency: string;
  historicalDepth: number;
  pricingType: string;
  accessType: string;
  licenseSummary: string;
  dataFormats: string[];
  apiAvailable: boolean;
  historicalDataAvailable: boolean;
  status: string;
  discoveryProvider: string;
  discoveredAt: string;
  scores: { quality: number; testability: number; economicRelevance: number; novelty: number; candidate: number };
  dataset: { snapshotId: string; rows: number; digest: string; createdAt: string; provider: string; retrievedAt: string; unit: string | null; quality: { warnings: string[]; medianIntervalMs: number; impossibleJumps: number; repeatedValueRatio: number } } | null;
  analysis: unknown;
  commitmentStatus: string;
  sensitivityMode: "PUBLIC_SOURCE" | "PRIVATE_SOURCE" | "HIGHLY_SENSITIVE_SOURCE";
  verificationStatus: "UNCLAIMED" | "PENDING_VERIFICATION" | "VERIFIED" | "REJECTED";
};

export type AlphaTest = {
  id: string;
  target: string;
  bestLag: number;
  sampleSize: number;
  evidenceScore: number;
  deltaR2: number;
  warnings: string[];
  baseline: { r2: number; mae: number; directionalAccuracy: number };
  augmented: { r2: number; mae: number; directionalAccuracy: number };
  correlationByLag: { lag: number; pearson: number; spearman: number; sampleSize: number }[];
  mutualInformation: number;
  crossCorrelation: number;
  stabilityAcrossFolds: number;
  folds: { fold: number; trainSize: number; testSize: number; deltaR2: number }[];
  commitmentStatus: string;
  sourceSnapshotId?: string;
  targetSnapshotId?: string;
  targetProvider?: string;
  horizon?: number;
  createdAt?: string;
};

export type SignalDetail = {
  test: AlphaTest;
  source: QarauSource;
  analysis: QarauSourceDetail["analysis"];
};

export type QarauSourceDetail = {
  source: QarauSource;
  privateMetadata: { summary: string; url: string };
  analysis: { phenomenon: string; industries: string[]; assetClasses: string[]; candidateTargets: string[]; causalHypotheses: string[]; potentialCausalChain: string[]; confounders: string[]; leakageRisks: string[]; informationAdvantage: string; additionalDataRequired: string[]; suggestedLagRange: number[]; confidence: number; tags: string[]; conclusion: string; disclosure: string; model: string } | null;
  tests: AlphaTest[];
  commitments: { id: string; kind: string; status: string; epoch: string | null; root: string | null; signature?: string | null }[];
  claims: { id: string; method: string; status: string; challenge: string; createdAt: string; expiresAt: string; verifiedAt: string | null }[];
  accessReceipts: { id: string; purpose: string; hash: string; createdAt: string; status: string }[];
};

export type QarauTarget = { symbol: string; provider: string; name: string; configured: boolean };
export type QarauProvider = { key: string; provider: string; name: string; category: string; region: string; description: string; documentationUrl: string };
export type QarauOptions = {
  categories: string[];
  industries: string[];
  geographies: string[];
  sourceTypes: string[];
  temporalResolutions: string[];
  updateFrequencies: string[];
  pricingTypes: string[];
  targets: QarauTarget[];
  providers: QarauProvider[];
  discoveryProviders: { id: string; configured: boolean }[];
  scoreWeights: Record<string, number>;
  analyzer: { provider: string; configured: boolean; externalEnabled: boolean };
};

export type QarauJob = { id: string; kind: string; resourceId: string; status: "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED"; progress: number; error: string | null; result: { sourceId?: string; snapshotId?: string; testId?: string } | null };

export type QarauFilters = Partial<Record<"q" | "category" | "industry" | "geography" | "sourceType" | "temporalResolution" | "updateFrequency" | "pricingType" | "apiAvailable" | "historicalDataAvailable" | "tested" | "committed" | "minHistoricalDepth" | "minQuality" | "minEconomicRelevance" | "minNovelty" | "minTestability" | "minCandidate" | "sort" | "page" | "pageSize", string>>;

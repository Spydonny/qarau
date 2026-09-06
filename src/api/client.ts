import type {
  Dataset,
  Gap,
  InventoryStats,
  Run,
  RunLanes,
  Session,
  SignalDetail,
  SignalSummary,
  QarauSource,
  QarauSourceDetail,
  AlphaTest,
  QarauFilters,
  QarauOptions,
  QarauJob,
} from "./types";

/** Thrown for any non-2xx response so callers can branch on status. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/**
 * The research API runs on its own host (Fly), separate from wherever this
 * bundle is served from. Every request below is therefore cross-origin, which
 * is why the session cookie needs credentials: "include" rather than
 * "same-origin", and why the server sends SameSite=None + CORS.
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? "";
let csrfToken = "";

/** Notified whenever the server rejects a request as unauthenticated. */
type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

export function onUnauthorized(fn: Listener) {
  unauthorizedListeners.add(fn);
  // Block body: Set.delete returns a boolean, and React treats any non-void
  // return from an effect as a cleanup function it should later call.
  return () => {
    unauthorizedListeners.delete(fn);
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    // The session is an httpOnly cookie; it has to be sent explicitly, and
    // "include" is what carries it to another origin.
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json", ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) } : undefined,
    ...init,
  });

  if (res.status === 401) {
    // A session can lapse mid-visit. Tell the app so it can drop back to the
    // authenticate screen instead of rendering an empty research view.
    for (const fn of unauthorizedListeners) fn();
    throw new ApiError(401, "unauthorized");
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Non-JSON error body; the status alone will do.
    }
    throw new ApiError(res.status, message);
  }

  const body = (await res.json()) as T;
  if (body && typeof body === "object" && "csrfToken" in body && typeof body.csrfToken === "string") csrfToken = body.csrfToken;
  return body;
}

/** Public and wallet endpoints have their own server-side authorization model.
 * They deliberately do not inherit the private-owner CSRF/session state. */
async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try { message = (await res.json()).error || message; } catch { /* status is enough */ }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

async function waitForJob(job: QarauJob, timeoutMs = 70_000) {
  const started = Date.now();
  let current = job;
  while (!["COMPLETE", "FAILED"].includes(current.status)) {
    if (Date.now() - started > timeoutMs) throw new ApiError(408, "job_timeout");
    await new Promise((resolve) => setTimeout(resolve, 500));
    current = (await request<{ job: QarauJob }>(`/api/qarau/jobs/${job.id}`)).job;
  }
  if (current.status === "FAILED") throw new ApiError(400, current.error || "job_failed");
  return current;
}

async function startAndWait(path: string, body: unknown = {}) {
  const { job } = await request<{ job: QarauJob }>(path, { method: "POST", body: JSON.stringify(body) });
  return waitForJob(job);
}

export type ResearchConfig = {
  targets: string[];
  universes: string[];
  horizons: string[];
};

export const api = {
  config: () => request<ResearchConfig>("/api/research/config"),

  session: () => request<Session>("/api/auth/session"),

  login: (password: string) =>
    request<Session>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  signals: () =>
    request<{ stats: InventoryStats; signals: SignalSummary[] }>("/api/research/signals"),

  signal: (id: string) => request<SignalDetail>(`/api/research/signals/${id}`),

  datasets: () => request<{ datasets: Dataset[] }>("/api/research/datasets"),

  gaps: () => request<{ gaps: Gap[] }>("/api/research/gaps"),

  runs: () => request<{ runs: Run[] }>("/api/research/runs"),

  runLanes: (id: string) => request<RunLanes>(`/api/research/runs/${id}/lanes`),

  startDiscovery: (target: string, horizon: string, universe: string) =>
    request<{ run: Run }>("/api/research/discovery/run", {
      method: "POST",
      body: JSON.stringify({ target, horizon, universe }),
    }),

  sources: (filters: QarauFilters = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
    return request<{ sources: QarauSource[]; pagination: { page: number; pageSize: number; total: number; pages: number } }>(`/api/qarau/sources${query ? `?${query}` : ""}`);
  },
  qarauOptions: () => request<QarauOptions>("/api/qarau/filters/options"),
  discoverSources: (input: { provider?: string; query?: string; providers?: string[] } = {}) => request("/api/qarau/sources/discover", { method: "POST", body: JSON.stringify(input) }),
  source: (id: string) => request<QarauSourceDetail>(`/api/qarau/sources/${id}`),
  manualSource: (input: { url: string; name?: string; sourceType?: string; category?: string; region?: string; sensitivityMode?: string }) => request<{ source: QarauSource }>("/api/qarau/sources/manual", { method: "POST", body: JSON.stringify(input) }),
  parseSource: (id: string) => startAndWait(`/api/qarau/sources/${id}/parse`),
  analyzeSource: (id: string) => startAndWait(`/api/qarau/sources/${id}/analyze`),
  connectSource: (id: string) => startAndWait(`/api/qarau/sources/${id}/connect`),
  ingestDataset: (id: string, csv: string) => request(`/api/qarau/sources/${id}/dataset`, { method: "POST", body: JSON.stringify({ csv }) }),
  ingestJsonDataset: (id: string, input: { url: string; timestampField: string; valueField: string; availableAtField?: string }) => startAndWait(`/api/qarau/sources/${id}/json-dataset`, input),
  alphaTest: async (id: string, input: { target: string; lag: number; horizon: number; equitySymbol?: string; targetCsv?: string }) => {
    const job = await startAndWait(`/api/qarau/sources/${id}/test`, input);
    if (!job.result?.testId) throw new ApiError(500, "missing_test_result");
    return request<{ test: AlphaTest }>(`/api/qarau/alpha-tests/${job.result.testId}`);
  },
  commitSource: (id: string) => request(`/api/qarau/sources/${id}/commit`, { method: "POST", body: "{}" }),
  commitTest: (id: string) => request(`/api/qarau/alpha-tests/${id}/commit`, { method: "POST", body: "{}" }),
  commitEpoch: () => request<{ committed: number; status?: string; signature?: string }>("/api/qarau/commitments/epoch", { method: "POST", body: "{}" }),
  commitmentSchedule: () => request<{ cadenceMinutes: number; nextEpochAt: string; queued: number; immediateMode: boolean }>("/api/qarau/commitments/schedule"),
  beginClaim: (id: string, method: string) => request(`/api/qarau/sources/${id}/claims`, { method: "POST", body: JSON.stringify({ method }) }),
  decideClaim: (id: string, claimId: string, decision: "VERIFIED" | "REJECTED") => request(`/api/qarau/sources/${id}/claims/${claimId}/decision`, { method: "POST", body: JSON.stringify({ decision }) }),
  recordAccessReceipt: (id: string, purpose: string) => request(`/api/qarau/sources/${id}/access-receipts`, { method: "POST", body: JSON.stringify({ purpose }) }),
};

export type V1Job = { id: string; status: "queued" | "running" | "retry_wait" | "completed" | "failed" | "dead_letter"; error_code?: string | null; error_detail?: string | null };
export type V1Source = { id: string; title: string | null; description: string | null; domain: string; source_type: string; status: string; expected_fields: unknown; temporal_coverage: unknown; expected_update_interval: string | null; reliability: Record<string, unknown>; license_status?: string; redistribution_rights?: boolean; derivative_rights?: boolean; screening_score?: number | null; screening_passed?: boolean | null; rejection_reasons?: string[]; screening?: { gates: Record<string, { status?: string; evidence?: string }>; score: number; passed: boolean; rejection_reasons: string[]; screened_at: string } | null; last_successful_ingestion_at: string | null; next_scrape_at: string | null; discovered_at: string };
export type V1DatasetVersion = { id: string; dataset_id: string; version: number; status: string; quality_metrics: Record<string, number>; coverage_start: string | null; coverage_end: string | null; frequency: string | null; record_count: number | null; missing_rate: number | null; duplicate_rate: number | null; outlier_rate: number | null; continuity: number | null; sealed_at: string | null };
export type V1Package = { id: string; status: string; public_metadata?: Record<string, unknown>; max_seats?: number; sealed_at?: string | null };
export type V1AnalysisPage = { analysis_run: Record<string, unknown>; signal_candidates: Array<Record<string, unknown>>; validations: Array<Record<string, unknown>>; leakage_checks: Array<Record<string, unknown>>; alpha_score_components: Array<Record<string, unknown>>; package: V1Package | null; pagination: { limit: number; offset: number; total: number; has_previous: boolean; has_next: boolean } };

export const v1 = {
  sources: () => request<{ sources: V1Source[] }>("/api/v1/sources"),
  source: (id: string) => request<{ source: V1Source; ingestion_runs: Array<Record<string, unknown>>; versions: V1DatasetVersion[]; analysis_runs: Array<Record<string, unknown>> }>(`/api/v1/sources/${id}`),
  discovery: (query_group = "general") => request<{ job: V1Job }>("/api/v1/discovery/jobs", { method: "POST", body: JSON.stringify({ query_group }) }),
  approve: (id: string, rights: { redistribution_rights: boolean; derivative_rights: boolean }) => request<{ source: V1Source }>(`/api/v1/sources/${id}/approve`, { method: "POST", body: JSON.stringify({ license_approved: true, ...rights }) }),
  scrape: (id: string) => request<{ job: V1Job }>(`/api/v1/sources/${id}/scrapes`, { method: "POST", body: "{}" }),
  job: (id: string) => request<{ job: V1Job }>(`/api/v1/jobs/${id}`),
  startAnalysis: (datasetVersionId: string, targetSymbol: string) => request<{ analysis_run: { id: string }; job: V1Job }>(`/api/v1/dataset-versions/${datasetVersionId}/analysis-runs`, { method: "POST", body: JSON.stringify({ target_symbol: targetSymbol }) }),
  analysis: (id: string, offset = 0, limit = 20) => request<V1AnalysisPage>(`/api/v1/analysis-runs/${id}?offset=${offset}&limit=${limit}`),
  createPackage: (analysisId: string, title: string, maxSeats: number) => request<{ package: V1Package; existing: boolean }>(`/api/v1/analysis-runs/${analysisId}/packages`, { method: "POST", body: JSON.stringify({ title, max_seats: maxSeats }) }),
  publishPackage: (packageId: string, terms: { opens_at?: string; closes_at?: string; minimum_bid_lamports?: number; max_winners?: number } = {}) => request<{ job: V1Job }>(`/api/v1/packages/${packageId}/publish`, { method: "POST", body: JSON.stringify(terms) }),
  settleAccessRound: (accessRoundId: string) => request<{ job: V1Job }>(`/api/v1/access-rounds/${accessRoundId}/settle`, { method: "POST", body: "{}" }),
  funnel: () => request<RunLanes>("/api/v1/cockpit/funnel"),
  opportunities: () => publicRequest<{ packages: Array<Record<string, unknown>> }>("/api/v1/opportunities"),
  opportunity: (packageId: string) => publicRequest<{ package: Record<string, unknown> }>(`/api/v1/opportunities/${packageId}`),
  proof: (packageId: string) => publicRequest<Record<string, unknown>>(`/api/v1/packages/${packageId}/proof`),
  siwsChallenge: (address: string) => publicRequest<{ nonce: string; message: string }>("/api/v1/auth/siws/challenge", { method: "POST", body: JSON.stringify({ address }) }),
  siwsVerify: (input: { address: string; nonce: string; signature: string }) => publicRequest<{ wallet: string; expires_at: string }>("/api/v1/auth/siws/verify", { method: "POST", body: JSON.stringify(input) }),
  walletSession: () => publicRequest<{ wallet: string; idle_expires_at: string; absolute_expires_at: string }>("/api/v1/auth/session"),
  bidTransaction: (roundPda: string, tier: "exclusive_early" | "delayed", amountLamports: number) => publicRequest<{ transaction_base64: string; bidPda: string }>(`/api/v1/access-rounds/${roundPda}/bid-transaction`, { method: "POST", body: JSON.stringify({ tier, amount_lamports: amountLamports }) }),
  confirmBid: (roundPda: string, transactionSignature: string) => publicRequest<{ package_id: string; bid_pda: string; status: string }>("/api/v1/bids/confirm", { method: "POST", body: JSON.stringify({ round_pda: roundPda, transaction_signature: transactionSignature }) }),
  claimTransaction: (roundPda: string) => publicRequest<{ transaction_base64: string; entitlementPda: string }>(`/api/v1/access-rounds/${roundPda}/claim-transaction`, { method: "POST", body: "{}" }),
  confirmEntitlement: (roundPda: string, transactionSignature: string) => publicRequest<{ package_id: string; entitlement_pda: string; status: string }>("/api/v1/entitlements/confirm", { method: "POST", body: JSON.stringify({ round_pda: roundPda, transaction_signature: transactionSignature }) }),
  refundTransaction: (roundPda: string) => publicRequest<{ transaction_base64: string }>(`/api/v1/access-rounds/${roundPda}/refund-transaction`, { method: "POST", body: "{}" }),
  accessEntitlements: () => publicRequest<{ entitlements: Array<Record<string, unknown>> }>("/api/v1/wallet/access-entitlements"),
  auctionPositions: () => publicRequest<{ positions: Array<Record<string, unknown>> }>("/api/v1/wallet/auction-positions"),
};

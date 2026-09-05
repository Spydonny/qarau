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

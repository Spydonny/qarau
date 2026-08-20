import type {
  Dataset,
  Gap,
  InventoryStats,
  Run,
  RunLanes,
  Session,
  SignalDetail,
  SignalSummary,
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
const API_BASE = "https://server-sparkling-hillside-7767.fly.dev";

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
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
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

  return (await res.json()) as T;
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

  startDiscovery: (target: string, horizon: string) =>
    request<{ run: Run }>("/api/research/discovery/run", {
      method: "POST",
      body: JSON.stringify({ target, horizon }),
    }),
};

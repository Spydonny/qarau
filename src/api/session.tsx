import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, onUnauthorized } from "./client";
import type { Session } from "./types";

type State =
  | { status: "checking" }
  | { status: "anonymous" }
  | { status: "owner"; session: Session };

type Ctx = {
  state: State;
  authenticate: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

/**
 * Holds whatever the server says about the current session.
 *
 * This is a convenience for rendering, never the access control itself: the
 * research endpoints check the cookie on every request, so editing state here
 * grants nothing.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;
    api
      .session()
      .then((session) => {
        if (!cancelled) setState({ status: "owner", session });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "anonymous" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // An expired session surfaces as a 401 on whatever request happens next.
  useEffect(() => onUnauthorized(() => setState({ status: "anonymous" })), []);

  const authenticate = useCallback(async (password: string) => {
    const session = await api.login(password);
    setState({ status: "owner", session });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setState({ status: "anonymous" });
    }
  }, []);

  const value = useMemo(
    () => ({ state, authenticate, signOut }),
    [state, authenticate, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

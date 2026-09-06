import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { api, onUnauthorized } from "./client";
import { SessionContext, type SessionState } from "./session-context";

/**
 * Holds whatever the server says about the current session.
 *
 * This is a convenience for rendering, never the access control itself: the
 * research endpoints check the cookie on every request, so editing state here
 * grants nothing.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  const [state, setState] = useState<SessionState>({ status: "checking" });

  useEffect(() => {
    if (!isAdminRoute) return;
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
  }, [isAdminRoute]);

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

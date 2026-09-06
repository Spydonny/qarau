import { createContext } from "react";
import type { Session } from "./types";

export type SessionState =
  | { status: "checking" }
  | { status: "anonymous" }
  | { status: "owner"; session: Session };

export type SessionContextValue = {
  state: SessionState;
  authenticate: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export const SessionContext = createContext<SessionContextValue | null>(null);

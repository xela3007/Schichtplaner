import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { TokenResponse } from "#shared/auth.js";
import { apiFetch, refreshSession } from "@/lib/api";
import { type SessionState, session } from "./session";

type AuthValue = {
  status: SessionState["status"];
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(session.subscribe, session.get);
  const queryClient = useQueryClient();
  const restored = useRef(false);

  // Restore the session after a reload via the refresh cookie — exactly once,
  // also under StrictMode's double effects.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (session.get().status === "loading") void refreshSession();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { accessToken } = await apiFetch("/auth/login", {
      method: "POST",
      body: { email, password },
      schema: TokenResponse,
    });
    session.setToken(accessToken);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      session.clear();
      queryClient.removeQueries({ queryKey: ["me"] });
    }
  }, [queryClient]);

  const value = useMemo(
    () => ({ status: state.status, login, logout }),
    [state.status, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

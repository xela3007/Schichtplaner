import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useAuth } from "./AuthProvider";

/** Pages behind login; anonymous users go to /login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === "loading")
    return <p className="p-8 text-muted-foreground">Sitzung wird geprüft …</p>;
  if (status === "anonymous") return <Navigate to="/login" replace />;
  return <>{children}</>;
}

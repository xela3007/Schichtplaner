import { useQuery } from "@tanstack/react-query";
import { MeResponse } from "#shared/auth.js";
import { useAuth } from "@/auth/AuthProvider";
import { apiFetch } from "@/lib/api";

export function useMe() {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch("/me", { schema: MeResponse, auth: true }),
    enabled: status === "authenticated",
  });
}

/** UI hint only — the API enforces every permission itself (ADR-010). */
export function useCan(permission: string): boolean {
  return useMe().data?.permissions.includes(permission) ?? false;
}

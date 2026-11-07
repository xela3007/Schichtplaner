import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

/** X-Forwarded-For is only trusted behind a known proxy (TRUST_PROXY=true). */
export function createClientIpResolver(trustProxy: boolean) {
  return (c: Context): string => {
    if (trustProxy) {
      const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
      if (forwarded) return forwarded;
    }
    try {
      return getConnInfo(c).remote.address ?? "unknown";
    } catch {
      return "unknown";
    }
  };
}

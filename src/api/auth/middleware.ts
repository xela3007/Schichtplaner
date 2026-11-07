import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types.js";
import { verifyAccessToken } from "./tokens.js";

export function requireAuth(jwtSecret: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const header = c.req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const claims = token ? await verifyAccessToken(token, jwtSecret) : null;
    if (!claims) {
      return c.json(
        { error: "unauthorized", requestId: c.get("requestId") },
        401,
      );
    }
    c.set("auth", { userId: claims.sub, permissions: claims.permissions });
    await next();
  });
}

/** ADR-010: authorization is always a permission check — never a role check. */
export function requirePermission(permission: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!c.get("auth")?.permissions.includes(permission)) {
      return c.json({ error: "forbidden", requestId: c.get("requestId") }, 403);
    }
    await next();
  });
}

import { Hono } from "hono";
import { requirePermission } from "../auth/middleware.js";
import type { AppEnv } from "../types.js";

/** Reference route: protected by exactly one permission (ADR-010). */
export function referenceRoutes() {
  return new Hono<AppEnv>().get(
    "/reference",
    requirePermission("reference.read"),
    (c) => c.json({ status: "ok" }, 200),
  );
}

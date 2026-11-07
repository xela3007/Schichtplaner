import { Hono } from "hono";
import { HealthResponse } from "#shared/health.js";
import type { BuildInfo } from "../build-info.js";

export function healthRoutes(buildInfo: BuildInfo) {
  return new Hono().get("/health", (c) => {
    const body = HealthResponse.parse({
      status: "ok",
      version: buildInfo.version,
      commit: buildInfo.commit,
      startedAt: buildInfo.startedAt.toISOString(),
      uptimeSeconds: Math.floor(
        (Date.now() - buildInfo.startedAt.getTime()) / 1000,
      ),
    });
    return c.json(body, 200);
  });
}

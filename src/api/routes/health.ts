import { Hono } from "hono";
import type { Logger } from "pino";
import { HealthResponse } from "#shared/health.js";
import type { BuildInfo } from "../build-info.js";

export type HealthDeps = {
  buildInfo: BuildInfo;
  checkDatabase: () => Promise<boolean>;
};

export function healthRoutes({ buildInfo, checkDatabase }: HealthDeps) {
  return new Hono<{ Variables: { log: Logger } }>().get(
    "/health",
    async (c) => {
      const databaseOk = await checkDatabase();
      if (!databaseOk) {
        c.get("log")?.warn("health check: database not reachable");
      }
      const body = HealthResponse.parse({
        status: databaseOk ? "ok" : "degraded",
        checks: { database: databaseOk ? "ok" : "error" },
        version: buildInfo.version,
        commit: buildInfo.commit,
        startedAt: buildInfo.startedAt.toISOString(),
        uptimeSeconds: Math.floor(
          (Date.now() - buildInfo.startedAt.getTime()) / 1000,
        ),
      });
      return c.json(body, databaseOk ? 200 : 503);
    },
  );
}

import { Hono } from "hono";
import { requestId } from "hono/request-id";
import type { Logger } from "pino";
import type { BuildInfo } from "./build-info.js";
import { healthRoutes } from "./routes/health.js";

export type AppDeps = {
  logger: Logger;
  buildInfo: BuildInfo;
};

type AppEnv = { Variables: { requestId: string; log: Logger } };

export function createApp({ logger, buildInfo }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(requestId());

  app.use(async (c, next) => {
    const log = logger.child({ requestId: c.get("requestId") });
    c.set("log", log);
    const start = performance.now();
    await next();
    log.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - start),
      },
      "request completed",
    );
  });

  app.route("/", healthRoutes(buildInfo));

  app.notFound((c) =>
    c.json({ error: "not_found", requestId: c.get("requestId") }, 404),
  );

  app.onError((error, c) => {
    (c.get("log") ?? logger).error({ err: error }, "unhandled error");
    return c.json(
      { error: "internal_error", requestId: c.get("requestId") },
      500,
    );
  });

  return app;
}

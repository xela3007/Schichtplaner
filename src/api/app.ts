import { type Context, Hono } from "hono";
import { requestId } from "hono/request-id";
import type { Logger } from "pino";
import { requireAuth } from "./auth/middleware.js";
import type { RateLimiter } from "./auth/rate-limit.js";
import type { AuthRepository } from "./auth/repository.js";
import { AuthService } from "./auth/service.js";
import type { BuildInfo } from "./build-info.js";
import type { Mailer } from "./mail/mailer.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";
import { referenceRoutes } from "./routes/reference.js";
import type { AppEnv } from "./types.js";

export type AppDeps = {
  logger: Logger;
  buildInfo: BuildInfo;
  checkDatabase: () => Promise<boolean>;
  auth: {
    repository: AuthRepository;
    rateLimiter: RateLimiter;
    mailer: Mailer;
    jwtSecret: string;
    publicApiUrl: string;
    secureCookies: boolean;
    clientIp: (c: Context) => string;
  };
};

export function createApp({ logger, buildInfo, checkDatabase, auth }: AppDeps) {
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

  const service = new AuthService(
    auth.repository,
    auth.rateLimiter,
    auth.mailer,
    { jwtSecret: auth.jwtSecret, publicApiUrl: auth.publicApiUrl },
    logger,
  );
  const authenticated = requireAuth(auth.jwtSecret);

  app.route("/", healthRoutes({ buildInfo, checkDatabase }));
  app.route(
    "/auth",
    authRoutes({
      service,
      secureCookies: auth.secureCookies,
      clientIp: auth.clientIp,
    }),
  );
  app.use("/me", authenticated);
  app.route("/", meRoutes(service));
  app.use("/reference", authenticated);
  app.route("/", referenceRoutes());

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

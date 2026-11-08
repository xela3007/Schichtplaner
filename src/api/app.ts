import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import type { Logger } from "pino";
import type { CookiePolicy } from "./auth/cookies.js";
import { requireAuth } from "./auth/middleware.js";
import type { RateLimiter } from "./auth/rate-limit.js";
import type { AuthRepository } from "./auth/repository.js";
import { AuthService } from "./auth/service.js";
import type { BuildInfo } from "./build-info.js";
import type {
  CatalogRepository,
  ContractTypeRepository,
} from "./catalogs/repository.js";
import type { EmployeeRepository } from "./employees/repository.js";
import type { LocationRepository } from "./locations/repository.js";
import type { Mailer } from "./mail/mailer.js";
import { authRoutes } from "./routes/auth.js";
import { catalogRoutes } from "./routes/catalogs.js";
import { employeeRoutes } from "./routes/employees.js";
import { healthRoutes } from "./routes/health.js";
import { locationRoutes } from "./routes/locations.js";
import { meRoutes } from "./routes/me.js";
import { referenceRoutes } from "./routes/reference.js";
import { staffingRoutes } from "./routes/staffing.js";
import type { StaffingRepository } from "./staffing/repository.js";
import type { AppEnv } from "./types.js";

export type AppDeps = {
  logger: Logger;
  buildInfo: BuildInfo;
  checkDatabase: () => Promise<boolean>;
  locations: LocationRepository;
  staffing: StaffingRepository;
  employees: EmployeeRepository;
  catalogs: {
    contractTypes: ContractTypeRepository;
    qualifications: CatalogRepository;
    systemAccesses: CatalogRepository;
  };
  auth: {
    repository: AuthRepository;
    rateLimiter: RateLimiter;
    mailer: Mailer;
    jwtSecret: string;
    webAppUrl: string;
    cookiePolicy: CookiePolicy;
    corsOrigins: readonly string[];
    plannerEmails?: readonly string[];
    clientIp: (c: Context) => string;
  };
};

export function createApp({
  logger,
  buildInfo,
  checkDatabase,
  auth,
  locations,
  staffing,
  employees,
  catalogs,
}: AppDeps) {
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

  // ADR-009: CORS is an explicit allowlist, never "*". Empty list (the
  // same-origin default, ADR-014) means no cross-origin access at all.
  if (auth.corsOrigins.length > 0) {
    const allowed = new Set(auth.corsOrigins);
    app.use(
      cors({
        origin: (origin) => (allowed.has(origin) ? origin : null),
        credentials: true,
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
        exposeHeaders: ["X-Request-Id", "Retry-After"],
      }),
    );
  }

  const service = new AuthService(
    auth.repository,
    auth.rateLimiter,
    auth.mailer,
    {
      jwtSecret: auth.jwtSecret,
      webAppUrl: auth.webAppUrl,
      plannerEmails: auth.plannerEmails,
    },
    logger,
  );
  const authenticated = requireAuth(auth.jwtSecret);

  app.route("/", healthRoutes({ buildInfo, checkDatabase }));
  app.route(
    "/auth",
    authRoutes({
      service,
      cookiePolicy: auth.cookiePolicy,
      clientIp: auth.clientIp,
    }),
  );
  app.use("/me", authenticated);
  app.route("/", meRoutes(service));
  app.use("/reference", authenticated);
  app.route("/", referenceRoutes());
  app.use("/locations", authenticated);
  app.use("/locations/*", authenticated);
  app.route("/", staffingRoutes(locations, staffing));
  app.route("/", locationRoutes(locations));
  for (const prefix of [
    "/employees",
    "/contract-types",
    "/qualifications",
    "/system-accesses",
  ]) {
    app.use(prefix, authenticated);
    app.use(`${prefix}/*`, authenticated);
  }
  app.route("/", catalogRoutes(catalogs));
  app.route("/", employeeRoutes({ employees, locations, ...catalogs }));

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

import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createClientIpResolver } from "./auth/client-ip.js";
import { cookiePolicy } from "./auth/cookies.js";
import { DbRateLimiter } from "./auth/rate-limit.js";
import { DrizzleAuthRepository } from "./auth/repository.js";
import { DrizzleAvailabilityRepository } from "./availability/repository.js";
import { getBuildInfo } from "./build-info.js";
import {
  DrizzleCatalogRepository,
  DrizzleContractTypeRepository,
} from "./catalogs/repository.js";
import { createDb } from "./db/client.js";
import { DrizzleEmployeeRepository } from "./employees/repository.js";
import { loadEnv } from "./env.js";
import { DrizzleLocationRepository } from "./locations/repository.js";
import { createLogger } from "./logger.js";
import { ConsoleMailer } from "./mail/mailer.js";
import { DrizzleStaffingRepository } from "./staffing/repository.js";

const env = loadEnv();
const logger = createLogger(env);
const buildInfo = getBuildInfo(env);
const { db, ping } = createDb(env.DATABASE_URL);
const mailer = new ConsoleMailer(logger);

if (env.NODE_ENV === "production" && mailer.kind === "console") {
  // ADR-005: don't abort, but make it impossible to miss.
  process.stderr.write(
    "\n!!! WARNING: no mail provider configured — verification mails are only logged.\n" +
      "!!! New users cannot verify their address until a provider is set up.\n\n",
  );
}

const app = createApp({
  logger,
  buildInfo,
  checkDatabase: ping,
  locations: new DrizzleLocationRepository(db),
  staffing: new DrizzleStaffingRepository(db),
  employees: new DrizzleEmployeeRepository(db),
  availability: new DrizzleAvailabilityRepository(db),
  catalogs: {
    contractTypes: new DrizzleContractTypeRepository(db),
    qualifications: DrizzleCatalogRepository.qualifications(db),
    systemAccesses: DrizzleCatalogRepository.systemAccesses(db),
  },
  auth: {
    repository: new DrizzleAuthRepository(db),
    rateLimiter: new DbRateLimiter(db),
    mailer,
    jwtSecret: env.JWT_SECRET,
    webAppUrl: env.WEB_APP_URL,
    cookiePolicy: cookiePolicy(
      env.NODE_ENV === "production",
      env.COOKIE_SAMESITE,
    ),
    corsOrigins: env.CORS_ORIGINS,
    plannerEmails: env.PLANNER_EMAILS,
    clientIp: createClientIpResolver(env.TRUST_PROXY),
  },
});

// Warn, don't abort: a scaled-to-zero Neon compute may still be waking up.
ping().then((ok) => {
  if (ok) logger.info("database reachable");
  else logger.warn("database not reachable at startup");
});

const server = serve(
  { fetch: app.fetch, port: env.PORT, hostname: env.HOST },
  (info) => {
    logger.info(
      { port: info.port, version: buildInfo.version, commit: buildInfo.commit },
      "server started",
    );
  },
);

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    logger.fatal({ port: env.PORT }, `port ${env.PORT} is already in use`);
  } else {
    logger.fatal({ err: error }, "server error");
  }
  process.exit(1);
});

function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    logger.info("server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

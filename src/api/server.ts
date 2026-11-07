import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { getBuildInfo } from "./build-info.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";

const env = loadEnv();
const logger = createLogger(env);
const buildInfo = getBuildInfo(env);
const app = createApp({ logger, buildInfo });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(
    { port: info.port, version: buildInfo.version, commit: buildInfo.commit },
    "server started",
  );
});

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

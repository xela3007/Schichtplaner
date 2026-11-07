import { type DestinationStream, type Logger, pino } from "pino";
import type { Env } from "./env.js";

// ADR-013: always redacted, centrally — a forgotten call site must not leak.
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "*.password",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.secret",
];

export function createLogger(
  env: Pick<Env, "NODE_ENV" | "LOG_LEVEL">,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[Redacted]" },
    ...(env.NODE_ENV === "development" && !destination
      ? { transport: { target: "pino-pretty" } }
      : {}),
  };
  return destination ? pino(options, destination) : pino(options);
}

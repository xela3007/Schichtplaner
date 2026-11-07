import type { Logger } from "pino";

export type AuthContext = { userId: string; permissions: readonly string[] };

/** Hono environment shared by all routes. */
export type AppEnv = {
  Variables: { requestId: string; log: Logger; auth: AuthContext };
};

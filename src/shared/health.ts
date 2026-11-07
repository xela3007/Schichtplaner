import { z } from "zod";

export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.object({
    database: z.enum(["ok", "error"]),
  }),
  version: z.string(),
  commit: z.string().nullable(),
  startedAt: z.iso.datetime(),
  uptimeSeconds: z.number().int().nonnegative(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;

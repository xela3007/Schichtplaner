import { z } from "zod";

export const HealthResponse = z.object({
  status: z.literal("ok"),
  version: z.string(),
  commit: z.string().nullable(),
  startedAt: z.iso.datetime(),
  uptimeSeconds: z.number().int().nonnegative(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;

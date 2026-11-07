import { z } from "zod";

export const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  GIT_COMMIT_SHA: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  readonly issues: readonly { variable: string; message: string }[];

  constructor(issues: readonly { variable: string; message: string }[]) {
    super(
      `Invalid environment configuration:\n${issues
        .map((i) => `  - ${i.variable}: ${i.message}`)
        .join("\n")}`,
    );
    this.name = "EnvError";
    this.issues = issues;
  }
}

type Source = Record<string, string | undefined>;

/** Pure: validates the given source, throws EnvError listing every bad variable. */
export function parseEnv(source: Source): Env {
  const input = {
    ...source,
    GIT_COMMIT_SHA: source.GIT_COMMIT_SHA ?? source.RAILWAY_GIT_COMMIT_SHA,
  };
  const result = EnvSchema.safeParse(input);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? "(root)"),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

/** Startup wrapper: aborts the process with a readable message instead of a stacktrace. */
export function loadEnv(source: Source = process.env): Env {
  try {
    return parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

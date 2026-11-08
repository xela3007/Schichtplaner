import { z } from "zod";

// Messages must never echo the value — connection strings carry passwords.
const postgresUrl = z
  .string({ error: "is required" })
  .refine((value) => /^postgres(ql)?:\/\/\S+$/.test(value), {
    error: "must be a postgres:// or postgresql:// URL",
  });

export const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  GIT_COMMIT_SHA: z.string().min(1).optional(),
  DATABASE_URL: postgresUrl,
  DATABASE_URL_UNPOOLED: postgresUrl.optional(),
  JWT_SECRET: z
    .string({ error: "is required" })
    .min(32, { error: "must be at least 32 characters" }),
  WEB_APP_URL: z
    .url({ error: "must be a URL" })
    .default("http://localhost:5173"),
  TRUST_PROXY: z
    .enum(["true", "false"], { error: 'must be "true" or "false"' })
    .default("false")
    .transform((value) => value === "true"),
  PLANNER_EMAILS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    )
    .pipe(
      z.array(
        z.email({ error: "must be a comma-separated list of email addresses" }),
      ),
    ),
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url({ error: "must be a comma-separated list of URLs" }))),
  COOKIE_SAMESITE: z
    .enum(["lax", "none"], { error: 'must be "lax" or "none"' })
    .default("lax"),
  // Railway's private network is IPv6 — "::" accepts IPv4 and IPv6 (ADR-014).
  HOST: z.string().min(1).default("::"),
  SEED_USER_EMAIL: z.email({ error: "must be an email address" }).optional(),
  SEED_USER_PASSWORD: z
    .string()
    .min(12, { error: "must be at least 12 characters" })
    .optional(),
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

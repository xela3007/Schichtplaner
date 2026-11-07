import { defineConfig } from "drizzle-kit";
import { z } from "zod";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — rely on the real environment (CI, platform).
}

const postgresUrl = z
  .string({ error: "is required" })
  .refine((value) => /^postgres(ql)?:\/\//.test(value), {
    error: "must be a postgres:// or postgresql:// URL",
  });

const result = postgresUrl.safeParse(
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL,
);
if (!result.success) {
  throw new Error(
    `drizzle.config: DATABASE_URL_UNPOOLED / DATABASE_URL ${result.error.issues[0]?.message}`,
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/shared/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: result.data },
});

// Pre-deploy migration (ADR-014): runs in the production image, where
// drizzle-kit (a devDependency) is not installed. Forward-only (ADR-004).
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { z } from "zod";

const Url = z
  .string({ error: "DATABASE_URL_UNPOOLED or DATABASE_URL is required" })
  .refine((v) => /^postgres(ql)?:\/\//.test(v), {
    error: "database URL must be postgres:// or postgresql://",
  });

const parsed = Url.safeParse(
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL,
);
if (!parsed.success) {
  // Never echo the value — it carries a password.
  process.stderr.write(`migrate: ${parsed.error.issues[0]?.message}\n`);
  process.exit(1);
}

const started = Date.now();
try {
  await migrate(drizzle(neon(parsed.data)), {
    migrationsFolder: new URL("../../../drizzle", import.meta.url).pathname,
  });
  process.stdout.write(
    `${JSON.stringify({ level: 30, msg: "migrations applied", durationMs: Date.now() - started })}\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${JSON.stringify({ level: 50, msg: "migration failed", error: message.replace(/postgres(ql)?:\/\/\S+/g, "[url]") })}\n`,
  );
  process.exit(1);
}

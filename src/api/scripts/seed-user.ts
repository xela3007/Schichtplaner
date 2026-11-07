// Dev-only: creates (or completes) a verified reference user with the roles
// `member` and `reference-reader`. Credentials come from SEED_USER_EMAIL /
// SEED_USER_PASSWORD in the local .env — never from the repo.
import { eq, inArray } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { roles, userRoles, users } from "#shared/db/schema.js";
import { hashPassword } from "../auth/password.js";
import { createDb } from "../db/client.js";
import { loadEnv } from "../env.js";

const env = loadEnv();
if (env.NODE_ENV === "production") {
  process.stderr.write("seed-user refuses to run with NODE_ENV=production\n");
  process.exit(1);
}
if (!env.SEED_USER_EMAIL || !env.SEED_USER_PASSWORD) {
  process.stderr.write("SEED_USER_EMAIL and SEED_USER_PASSWORD must be set\n");
  process.exit(1);
}

const email = env.SEED_USER_EMAIL.trim().toLowerCase();
const { db } = createDb(env.DATABASE_URL);

const seedRoles = await db
  .select({ id: roles.id, key: roles.key })
  .from(roles)
  .where(inArray(roles.key, ["member", "reference-reader"]));
if (seedRoles.length !== 2) {
  process.stderr.write("roles missing — run `npm run db:migrate` first\n");
  process.exit(1);
}

const [existing] = await db
  .select({ id: users.id })
  .from(users)
  .where(eq(users.email, email));
const userId = existing?.id ?? uuidv7();
if (!existing) {
  await db.insert(users).values({
    id: userId,
    email,
    passwordHash: await hashPassword(env.SEED_USER_PASSWORD),
    emailVerifiedAt: new Date(),
  });
}
await db
  .insert(userRoles)
  .values(seedRoles.map((r) => ({ userId, roleId: r.id })))
  .onConflictDoNothing();

process.stdout.write(
  `seed user ${existing ? "already existed" : "created"}; roles: ${seedRoles.map((r) => r.key).join(", ")}\n`,
);

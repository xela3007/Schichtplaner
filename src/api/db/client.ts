import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

const PING_TIMEOUT_MS = 2000;

export function createDb(url: string) {
  const db = drizzle(neon(url));

  /** Never throws and never logs the URL — false means "not reachable". */
  async function ping(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), PING_TIMEOUT_MS);
    });
    const query = db
      .execute(sql`select 1`)
      .then(() => true)
      .catch(() => false);
    try {
      return await Promise.race([query, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  return { db, ping };
}

export type Db = ReturnType<typeof createDb>["db"];

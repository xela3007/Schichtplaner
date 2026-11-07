import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

export type RateLimitResult = { allowed: boolean; retryAfterSec: number };

export interface RateLimiter {
  hit(key: string, limit: number, windowSec: number): Promise<RateLimitResult>;
}

/** ADR-005: counters live in the DB, incremented by one atomic upsert. */
export class DbRateLimiter implements RateLimiter {
  constructor(private readonly db: Db) {}

  async hit(
    key: string,
    limit: number,
    windowSec: number,
  ): Promise<RateLimitResult> {
    const result = await this.db.execute<{
      count: number;
      retry_after: number;
    }>(sql`
      insert into rate_limits (key, window_start, count)
      values (${key}, now(), 1)
      on conflict (key) do update set
        count = case
          when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then 1
          else rate_limits.count + 1
        end,
        window_start = case
          when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then now()
          else rate_limits.window_start
        end,
        updated_at = now()
      returning count,
        greatest(1, ceil(extract(epoch from (window_start + make_interval(secs => ${windowSec}) - now()))))::int as retry_after
    `);
    const row = result.rows[0];
    if (!row) throw new Error("rate limit upsert returned no row");
    return {
      allowed: Number(row.count) <= limit,
      retryAfterSec: Number(row.retry_after),
    };
  }
}

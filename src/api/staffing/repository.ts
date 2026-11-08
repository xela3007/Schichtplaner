import { eq, sql } from "drizzle-orm";
import { locationStaffing } from "#shared/db/schema.js";
import type { Staffing, StaffingWindow } from "#shared/staffing.js";
import type { Db } from "../db/client.js";

export type SaveResult =
  | { kind: "ok"; staffing: Staffing }
  | { kind: "conflict"; current: Staffing };

export interface StaffingRepository {
  get(locationId: string): Promise<Staffing>;
  save(
    locationId: string,
    windows: StaffingWindow[],
    version: number,
  ): Promise<SaveResult>;
}

type Row = { windows: unknown; version: number; updatedAt: string };

export const EMPTY_STAFFING: Staffing = {
  windows: [],
  version: 0,
  updatedAt: null,
};

function toStaffing(row: {
  windows: unknown;
  version: number;
  updatedAt: Date | string;
}): Staffing {
  return {
    windows: row.windows as StaffingWindow[],
    version: row.version,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export class DrizzleStaffingRepository implements StaffingRepository {
  constructor(private readonly db: Db) {}

  async get(locationId: string): Promise<Staffing> {
    const [row] = await this.db
      .select()
      .from(locationStaffing)
      .where(eq(locationStaffing.locationId, locationId));
    return row ? toStaffing(row) : EMPTY_STAFFING;
  }

  /**
   * Version-checked write, one statement either way (ADR-015):
   * version 0 = first save → insert that succeeds only once (two first saves
   * can't both win); otherwise → update only if the version still matches.
   */
  async save(
    locationId: string,
    windows: StaffingWindow[],
    version: number,
  ): Promise<SaveResult> {
    const json = JSON.stringify(windows);
    const result =
      version === 0
        ? await this.db.execute<Row>(sql`
            insert into ${locationStaffing} (location_id, windows, version)
            values (${locationId}, ${json}::jsonb, 1)
            on conflict (location_id) do nothing
            returning windows, version, updated_at as "updatedAt"
          `)
        : await this.db.execute<Row>(sql`
            update ${locationStaffing}
            set windows = ${json}::jsonb, version = version + 1, updated_at = now()
            where location_id = ${locationId} and version = ${version}
            returning windows, version, updated_at as "updatedAt"
          `);
    const row = result.rows[0];
    if (row) return { kind: "ok", staffing: toStaffing(row) };
    return { kind: "conflict", current: await this.get(locationId) };
  }
}

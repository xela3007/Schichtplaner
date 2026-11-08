import { asc, desc, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { auditEvents, locations, users } from "#shared/db/schema.js";
import type {
  AuditAction,
  AuditEntry,
  Location,
  LocationInput,
} from "#shared/locations.js";
import type { Db } from "../db/client.js";
import { type Changes, diffLocation, normalizeHours } from "./diff.js";

export const ENTITY_TYPE = "location";

export type WriteResult =
  | { kind: "ok"; location: Location }
  | { kind: "conflict"; current: Location }
  | { kind: "name_taken" }
  | { kind: "not_found" };

export interface LocationRepository {
  list(opts: { includeInactive: boolean }): Promise<Location[]>;
  get(id: string): Promise<Location | null>;
  create(input: LocationInput, actorId: string): Promise<WriteResult>;
  update(
    id: string,
    input: LocationInput,
    version: number,
    actorId: string,
  ): Promise<WriteResult>;
  setActive(
    id: string,
    active: boolean,
    version: number,
    actorId: string,
  ): Promise<WriteResult>;
  history(id: string): Promise<AuditEntry[]>;
}

type Row = typeof locations.$inferSelect;

export function toLocation(row: {
  id: string;
  name: string;
  kind: string;
  openingHours: unknown;
  active: boolean;
  version: number;
  updatedAt: Date | string;
}): Location {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as Location["kind"],
    openingHours: row.openingHours as Location["openingHours"],
    active: row.active,
    version: row.version,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function isNameTaken(error: unknown): boolean {
  const e = error as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  const code = e.code ?? e.cause?.code;
  const constraint = e.constraint ?? e.cause?.constraint;
  return (
    code === "23505" &&
    (!constraint || constraint === "locations_name_lower_idx")
  );
}

const RETURNING = sql`id, name, kind, opening_hours as "openingHours", active, version, updated_at as "updatedAt"`;

export class DrizzleLocationRepository implements LocationRepository {
  constructor(private readonly db: Db) {}

  async list({ includeInactive }: { includeInactive: boolean }) {
    const rows = await this.db
      .select()
      .from(locations)
      .where(includeInactive ? undefined : eq(locations.active, true))
      .orderBy(asc(sql`lower(${locations.name})`));
    return rows.map(toLocation);
  }

  async get(id: string) {
    const [row] = await this.db
      .select()
      .from(locations)
      .where(eq(locations.id, id));
    return row ? toLocation(row) : null;
  }

  async create(input: LocationInput, actorId: string): Promise<WriteResult> {
    const id = uuidv7();
    const hours = normalizeHours(input.openingHours);
    const changes = diffLocation(null, { ...input, openingHours: hours });
    try {
      // One statement: row + audit entry (ADR-015).
      const result = await this.db.execute<Row>(sql`
        with created as (
          insert into ${locations} (id, name, kind, opening_hours)
          values (${id}, ${input.name}, ${input.kind}, ${JSON.stringify(hours)}::jsonb)
          returning ${RETURNING}
        ), audit as (
          insert into ${auditEvents} (id, entity_type, entity_id, action, actor_user_id, changes)
          select ${uuidv7()}, ${ENTITY_TYPE}, created.id, 'created', ${actorId}, ${JSON.stringify(changes)}::jsonb
          from created
        )
        select * from created
      `);
      const row = result.rows[0];
      if (!row) throw new Error("insert returned no row");
      return { kind: "ok", location: toLocation(row) };
    } catch (error) {
      if (isNameTaken(error)) return { kind: "name_taken" };
      throw error;
    }
  }

  async update(
    id: string,
    input: LocationInput,
    version: number,
    actorId: string,
  ): Promise<WriteResult> {
    const before = await this.get(id);
    if (!before) return { kind: "not_found" };
    const hours = normalizeHours(input.openingHours);
    const changes = diffLocation(before, { ...input, openingHours: hours });
    return this.versionedWrite(
      id,
      version,
      "updated",
      changes,
      sql`
      name = ${input.name}, kind = ${input.kind}, opening_hours = ${JSON.stringify(hours)}::jsonb
    `,
      actorId,
    );
  }

  async setActive(
    id: string,
    active: boolean,
    version: number,
    actorId: string,
  ): Promise<WriteResult> {
    const before = await this.get(id);
    if (!before) return { kind: "not_found" };
    const changes: Changes =
      before.active === active
        ? {}
        : { active: { from: before.active, to: active } };
    return this.versionedWrite(
      id,
      version,
      active ? "reactivated" : "deactivated",
      changes,
      sql`active = ${active}`,
      actorId,
    );
  }

  /**
   * Version-checked update + audit entry in ONE statement (ADR-015). If the
   * version doesn't match, nothing is written — not even the audit entry.
   */
  private async versionedWrite(
    id: string,
    version: number,
    action: AuditAction,
    changes: Changes,
    set: ReturnType<typeof sql>,
    actorId?: string,
  ): Promise<WriteResult> {
    try {
      const result = await this.db.execute<Row>(sql`
        with changed as (
          update ${locations}
          set ${set}, version = version + 1, updated_at = now()
          where id = ${id} and version = ${version}
          returning ${RETURNING}
        ), audit as (
          insert into ${auditEvents} (id, entity_type, entity_id, action, actor_user_id, changes)
          select ${uuidv7()}, ${ENTITY_TYPE}, changed.id, ${action}, ${actorId ?? null}, ${JSON.stringify(changes)}::jsonb
          from changed
        )
        select * from changed
      `);
      const row = result.rows[0];
      if (row) return { kind: "ok", location: toLocation(row) };
      const current = await this.get(id);
      return current ? { kind: "conflict", current } : { kind: "not_found" };
    } catch (error) {
      if (isNameTaken(error)) return { kind: "name_taken" };
      throw error;
    }
  }

  async history(id: string): Promise<AuditEntry[]> {
    const rows = await this.db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        actorEmail: users.email,
        occurredAt: auditEvents.occurredAt,
        changes: auditEvents.changes,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(
        sql`${auditEvents.entityType} = ${ENTITY_TYPE} and ${auditEvents.entityId} = ${id}`,
      )
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id));
    return rows.map((r) => ({
      id: r.id,
      action: r.action as AuditAction,
      actorEmail: r.actorEmail ?? null,
      occurredAt: r.occurredAt.toISOString(),
      changes: r.changes,
    }));
  }
}

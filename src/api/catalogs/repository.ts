import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import type {
  CatalogEntry,
  ContractType,
  ContractTypeInput,
} from "#shared/catalogs.js";
import {
  auditEvents,
  contractTypes,
  employees,
  qualifications,
  systemAccesses,
} from "#shared/db/schema.js";
import type { AuditAction } from "#shared/locations.js";
import {
  type Changes,
  diffFields,
  isUniqueViolation,
} from "../audit/history.js";
import type { Db } from "../db/client.js";

export type CatalogResult<T> =
  | { kind: "ok"; entry: T }
  | { kind: "conflict"; current: T }
  | { kind: "name_taken" }
  | { kind: "not_found" }
  | { kind: "in_use"; current: T };

/** Qualifications and system accesses: name only. */
export interface CatalogRepository {
  list(): Promise<CatalogEntry[]>;
  create(name: string, actorId: string): Promise<CatalogResult<CatalogEntry>>;
  rename(
    id: string,
    name: string,
    version: number,
    actorId: string,
  ): Promise<CatalogResult<CatalogEntry>>;
  setActive(
    id: string,
    active: boolean,
    version: number,
    actorId: string,
  ): Promise<CatalogResult<CatalogEntry>>;
}

export interface ContractTypeRepository {
  list(): Promise<ContractType[]>;
  create(
    input: ContractTypeInput,
    actorId: string,
  ): Promise<CatalogResult<ContractType>>;
  /** Hours are locked while any employee (active or not) uses the type → in_use. */
  update(
    id: string,
    input: ContractTypeInput,
    version: number,
    actorId: string,
  ): Promise<CatalogResult<ContractType>>;
  setActive(
    id: string,
    active: boolean,
    version: number,
    actorId: string,
  ): Promise<CatalogResult<ContractType>>;
}

const iso = (v: Date | string) => new Date(v).toISOString();

type EntryRow = {
  id: string;
  name: string;
  active: boolean;
  version: number;
  updatedAt: string;
};
const toEntry = (r: EntryRow): CatalogEntry => ({
  ...r,
  updatedAt: iso(r.updatedAt),
});

const audit = (
  entityType: string,
  from: string,
  action: AuditAction,
  changes: Changes,
  actorId: string,
) => sql`
  insert into ${auditEvents} (id, entity_type, entity_id, action, actor_user_id, changes)
  select ${uuidv7()}, ${entityType}, ${sql.raw(from)}.id, ${action}, ${actorId}, ${JSON.stringify(changes)}::jsonb
  from ${sql.raw(from)}`;

export class DrizzleCatalogRepository implements CatalogRepository {
  constructor(
    private readonly db: Db,
    private readonly table: PgTable,
    private readonly entityType: string,
    private readonly nameIndex: string,
  ) {}

  static qualifications(db: Db) {
    return new DrizzleCatalogRepository(
      db,
      qualifications,
      "qualification",
      "qualifications_name_lower_idx",
    );
  }
  static systemAccesses(db: Db) {
    return new DrizzleCatalogRepository(
      db,
      systemAccesses,
      "system_access",
      "system_accesses_name_lower_idx",
    );
  }

  private returning = sql`id, name, active, version, updated_at as "updatedAt"`;

  async list() {
    const r = await this.db.execute<EntryRow>(
      sql`select ${this.returning} from ${this.table} order by lower(name)`,
    );
    return r.rows.map(toEntry);
  }

  private async get(id: string) {
    const r = await this.db.execute<EntryRow>(
      sql`select ${this.returning} from ${this.table} where id = ${id}`,
    );
    return r.rows[0] ? toEntry(r.rows[0]) : null;
  }

  async create(
    name: string,
    actorId: string,
  ): Promise<CatalogResult<CatalogEntry>> {
    try {
      const r = await this.db.execute<EntryRow>(sql`
        with created as (
          insert into ${this.table} (id, name) values (${uuidv7()}, ${name}) returning ${this.returning}
        ), a as (${audit(this.entityType, "created", "created", { name: { from: null, to: name } }, actorId)})
        select * from created`);
      return { kind: "ok", entry: toEntry(r.rows[0] as EntryRow) };
    } catch (error) {
      if (isUniqueViolation(error, this.nameIndex))
        return { kind: "name_taken" };
      throw error;
    }
  }

  rename(id: string, name: string, version: number, actorId: string) {
    return this.write(
      id,
      version,
      "updated",
      sql`name = ${name}`,
      (b) => diffFields(b, { ...b, name }, ["name"]),
      actorId,
    );
  }

  setActive(id: string, active: boolean, version: number, actorId: string) {
    return this.write(
      id,
      version,
      active ? "reactivated" : "deactivated",
      sql`active = ${active}`,
      (b) => diffFields(b, { ...b, active }, ["active"]),
      actorId,
    );
  }

  private async write(
    id: string,
    version: number,
    action: AuditAction,
    set: ReturnType<typeof sql>,
    diff: (before: CatalogEntry) => Changes,
    actorId: string,
  ): Promise<CatalogResult<CatalogEntry>> {
    const before = await this.get(id);
    if (!before) return { kind: "not_found" };
    try {
      const r = await this.db.execute<EntryRow>(sql`
        with changed as (
          update ${this.table} set ${set}, version = version + 1, updated_at = now()
          where id = ${id} and version = ${version}
          returning ${this.returning}
        ), a as (${audit(this.entityType, "changed", action, diff(before), actorId)})
        select * from changed`);
      if (r.rows[0]) return { kind: "ok", entry: toEntry(r.rows[0]) };
      const current = await this.get(id);
      return current ? { kind: "conflict", current } : { kind: "not_found" };
    } catch (error) {
      if (isUniqueViolation(error, this.nameIndex))
        return { kind: "name_taken" };
      throw error;
    }
  }
}

type CtRow = Omit<ContractType, "updatedAt"> & { updatedAt: string };
const toCt = (r: CtRow): ContractType => ({
  ...r,
  allowedShiftMinutes: (r.allowedShiftMinutes ?? []).map(Number),
  updatedAt: iso(r.updatedAt),
});
const CT_FIELDS = [
  "name",
  "weeklyMinutes",
  "typicalShiftMinutes",
  "allowedShiftMinutes",
  "maxDailyMinutes",
] as const;
const CT_INDEX = "contract_types_name_lower_idx";

export class DrizzleContractTypeRepository implements ContractTypeRepository {
  constructor(private readonly db: Db) {}

  private select = (where: ReturnType<typeof sql>) => sql`
    select ct.id, ct.name, ct.weekly_minutes as "weeklyMinutes", ct.typical_shift_minutes as "typicalShiftMinutes",
      ct.allowed_shift_minutes as "allowedShiftMinutes", ct.max_daily_minutes as "maxDailyMinutes",
      ct.active, ct.version, ct.updated_at as "updatedAt",
      exists (select 1 from ${employees} e where e.contract_type_id = ct.id) as "inUse"
    from ${contractTypes} ct ${where}`;

  async list() {
    const r = await this.db.execute<CtRow>(
      sql`${this.select(sql``)} order by lower(ct.name)`,
    );
    return r.rows.map(toCt);
  }

  private async get(id: string) {
    const r = await this.db.execute<CtRow>(
      this.select(sql`where ct.id = ${id}`),
    );
    return r.rows[0] ? toCt(r.rows[0]) : null;
  }

  private intArray(a: number[]) {
    return sql`(select coalesce(array_agg(value::int order by value::int), '{}'::int[]) from jsonb_array_elements_text(${JSON.stringify(a)}::jsonb))`;
  }

  async create(
    input: ContractTypeInput,
    actorId: string,
  ): Promise<CatalogResult<ContractType>> {
    const id = uuidv7();
    try {
      await this.db.execute(sql`
        with created as (
          insert into ${contractTypes} (id, name, weekly_minutes, typical_shift_minutes, allowed_shift_minutes, max_daily_minutes)
          values (${id}, ${input.name}, ${input.weeklyMinutes}, ${input.typicalShiftMinutes}::int,
            ${this.intArray(input.allowedShiftMinutes)}, ${input.maxDailyMinutes}::int)
          returning id
        ), a as (${audit("contract_type", "created", "created", diffFields(null, input, [...CT_FIELDS]), actorId)})
        select id from created`);
      return { kind: "ok", entry: (await this.get(id)) as ContractType };
    } catch (error) {
      if (isUniqueViolation(error, CT_INDEX)) return { kind: "name_taken" };
      throw error;
    }
  }

  async update(
    id: string,
    input: ContractTypeInput,
    version: number,
    actorId: string,
  ): Promise<CatalogResult<ContractType>> {
    const before = await this.get(id);
    if (!before) return { kind: "not_found" };
    try {
      // Single statement: the in-use check sits in the WHERE, so an employee
      // assigned concurrently can't slip past it (ADR-015 / spec §6).
      const r = await this.db.execute<{ id: string }>(sql`
        with changed as (
          update ${contractTypes} ct set name = ${input.name}, weekly_minutes = ${input.weeklyMinutes},
            typical_shift_minutes = ${input.typicalShiftMinutes}::int,
            allowed_shift_minutes = ${this.intArray(input.allowedShiftMinutes)},
            max_daily_minutes = ${input.maxDailyMinutes}::int,
            version = ct.version + 1, updated_at = now()
          where ct.id = ${id} and ct.version = ${version} and (
            not exists (select 1 from ${employees} e where e.contract_type_id = ct.id) or (
              ct.weekly_minutes = ${input.weeklyMinutes}
              and ct.typical_shift_minutes is not distinct from ${input.typicalShiftMinutes}::int
              and ct.max_daily_minutes is not distinct from ${input.maxDailyMinutes}::int
              and ct.allowed_shift_minutes = ${this.intArray(input.allowedShiftMinutes)}
            )
          )
          returning ct.id
        ), a as (${audit("contract_type", "changed", "updated", diffFields(before, input, [...CT_FIELDS]), actorId)})
        select id from changed`);
      const current = await this.get(id);
      if (!current) return { kind: "not_found" };
      if (r.rows[0]) return { kind: "ok", entry: current };
      return current.version !== version
        ? { kind: "conflict", current }
        : { kind: "in_use", current };
    } catch (error) {
      if (isUniqueViolation(error, CT_INDEX)) return { kind: "name_taken" };
      throw error;
    }
  }

  async setActive(
    id: string,
    active: boolean,
    version: number,
    actorId: string,
  ): Promise<CatalogResult<ContractType>> {
    const before = await this.get(id);
    if (!before) return { kind: "not_found" };
    const r = await this.db.execute<{ id: string }>(sql`
      with changed as (
        update ${contractTypes} set active = ${active}, version = version + 1, updated_at = now()
        where id = ${id} and version = ${version} returning id
      ), a as (${audit("contract_type", "changed", active ? "reactivated" : "deactivated", diffFields(before, { ...before, active }, ["active"]), actorId)})
      select id from changed`);
    const current = (await this.get(id)) as ContractType;
    return r.rows[0]
      ? { kind: "ok", entry: current }
      : { kind: "conflict", current };
  }
}

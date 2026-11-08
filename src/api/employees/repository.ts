import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  auditEvents,
  employeeLocations,
  employeeQualifications,
  employeeSystemAccesses,
  employees,
  locations,
} from "#shared/db/schema.js";
import type { Employee, EmployeeInput } from "#shared/employees.js";
import type { AuditAction, AuditEntry } from "#shared/locations.js";
import { type Changes, historyFor } from "../audit/history.js";
import type { Db } from "../db/client.js";
import { diffEmployee } from "./diff.js";

export const ENTITY_TYPE = "employee";

export type EmployeeResult =
  | { kind: "ok"; employee: Employee }
  | { kind: "conflict"; current: Employee }
  | { kind: "not_found" };

export interface EmployeeRepository {
  list(): Promise<Employee[]>;
  get(id: string): Promise<Employee | null>;
  /** `input.locations` must only contain ACTIVE locations; rows of inactive locations are kept untouched. */
  create(input: EmployeeInput, actorId: string): Promise<EmployeeResult>;
  update(
    id: string,
    input: EmployeeInput,
    version: number,
    actorId: string,
  ): Promise<EmployeeResult>;
  setActive(
    id: string,
    active: boolean,
    version: number,
    actorId: string,
  ): Promise<EmployeeResult>;
  history(id: string): Promise<AuditEntry[]>;
}

type Row = Omit<Employee, "updatedAt"> & { updatedAt: string };

const SELECT = sql`
  select e.id, e.first_name as "firstName", e.last_name as "lastName", e.mobile, e.email,
    e.personnel_no as "personnelNo", e.contract_type_id as "contractTypeId",
    e.weekly_minutes_override as "weeklyMinutesOverride", e.is_floater as "isFloater", e.note,
    e.active, e.version, e.updated_at as "updatedAt",
    coalesce((select json_agg(q.qualification_id order by q.qualification_id)
      from ${employeeQualifications} q where q.employee_id = e.id), '[]') as "qualificationIds",
    coalesce((select json_agg(s.system_access_id order by s.system_access_id)
      from ${employeeSystemAccesses} s where s.employee_id = e.id), '[]') as "systemAccessIds",
    coalesce((select json_agg(json_build_object('locationId', l.location_id, 'trained', l.trained, 'preference', l.preference) order by l.location_id)
      from ${employeeLocations} l where l.employee_id = e.id), '[]') as "locations"
  from ${employees} e`;

const toEmployee = (r: Row): Employee => ({
  ...r,
  updatedAt: new Date(r.updatedAt).toISOString(),
});

const json = (v: unknown) => sql`${JSON.stringify(v)}::jsonb`;

/** Join-table maintenance hanging off a CTE named `target` (no row there → no effect). */
function joinCtes(input: EmployeeInput) {
  const locs = input.locations.map((l) => ({
    location_id: l.locationId,
    trained: l.trained,
    preference: l.preference,
  }));
  // Deletes only touch keys NOT in the new set, inserts only keys IN it — the
  // sibling CTEs never fight over the same row.
  return sql`
    dq as (delete from ${employeeQualifications} x using target
      where x.employee_id = target.id and not (x.qualification_id::text in (select jsonb_array_elements_text(${json(input.qualificationIds)})))),
    iq as (insert into ${employeeQualifications} (employee_id, qualification_id)
      select target.id, v::uuid from target, jsonb_array_elements_text(${json(input.qualificationIds)}) v on conflict do nothing),
    ds as (delete from ${employeeSystemAccesses} x using target
      where x.employee_id = target.id and not (x.system_access_id::text in (select jsonb_array_elements_text(${json(input.systemAccessIds)})))),
    is_ as (insert into ${employeeSystemAccesses} (employee_id, system_access_id)
      select target.id, v::uuid from target, jsonb_array_elements_text(${json(input.systemAccessIds)}) v on conflict do nothing),
    dl as (delete from ${employeeLocations} x using target, ${locations} loc
      where x.employee_id = target.id and loc.id = x.location_id and loc.active
        and not (x.location_id::text in (select r->>'location_id' from jsonb_array_elements(${json(locs)}) r))),
    il as (insert into ${employeeLocations} (employee_id, location_id, trained, preference)
      select target.id, r.location_id, r.trained, r.preference
      from target, jsonb_to_recordset(${json(locs)}) as r(location_id uuid, trained boolean, preference text)
      on conflict (employee_id, location_id) do update set trained = excluded.trained, preference = excluded.preference)`;
}

const auditCte = (
  action: AuditAction,
  changes: Changes,
  actorId: string,
) => sql`
  a as (insert into ${auditEvents} (id, entity_type, entity_id, action, actor_user_id, changes)
    select ${uuidv7()}, ${ENTITY_TYPE}, target.id, ${action}, ${actorId}, ${json(changes)} from target)`;

export class DrizzleEmployeeRepository implements EmployeeRepository {
  constructor(private readonly db: Db) {}

  async list() {
    const r = await this.db.execute<Row>(
      sql`${SELECT} order by lower(e.last_name), lower(e.first_name)`,
    );
    return r.rows.map(toEmployee);
  }

  async get(id: string) {
    const r = await this.db.execute<Row>(sql`${SELECT} where e.id = ${id}`);
    return r.rows[0] ? toEmployee(r.rows[0]) : null;
  }

  /** Locations of inactive locations survive saves — merge them in for the audit diff. */
  private async withPreserved(
    before: Employee | null,
    input: EmployeeInput,
  ): Promise<EmployeeInput> {
    if (!before) return input;
    const r = await this.db.execute<{ id: string }>(
      sql`select id from ${locations} where active = false`,
    );
    const inactive = new Set(r.rows.map((x) => x.id));
    const kept = before.locations.filter((l) => inactive.has(l.locationId));
    return { ...input, locations: [...input.locations, ...kept] };
  }

  async create(input: EmployeeInput, actorId: string): Promise<EmployeeResult> {
    const id = uuidv7();
    await this.db.execute(sql`
      with target as (
        insert into ${employees} (id, first_name, last_name, personnel_no, mobile, email, contract_type_id,
          weekly_minutes_override, is_floater, note)
        values (${id}, ${input.firstName}, ${input.lastName}, ${input.personnelNo}, ${input.mobile}, ${input.email},
          ${input.contractTypeId}, ${input.weeklyMinutesOverride}::int, ${input.isFloater}, ${input.note})
        returning id
      ), ${joinCtes(input)}, ${auditCte("created", diffEmployee(null, input), actorId)}
      select id from target`);
    return { kind: "ok", employee: (await this.get(id)) as Employee };
  }

  async update(
    id: string,
    input: EmployeeInput,
    version: number,
    actorId: string,
  ): Promise<EmployeeResult> {
    const before = await this.get(id);
    if (!before) return { kind: "not_found" };
    const after = await this.withPreserved(before, input);
    const r = await this.db.execute<{ id: string }>(sql`
      with target as (
        update ${employees} set first_name = ${input.firstName}, last_name = ${input.lastName},
          personnel_no = ${input.personnelNo}, mobile = ${input.mobile}, email = ${input.email},
          contract_type_id = ${input.contractTypeId}, weekly_minutes_override = ${input.weeklyMinutesOverride}::int,
          is_floater = ${input.isFloater}, note = ${input.note}, version = version + 1, updated_at = now()
        where id = ${id} and version = ${version}
        returning id
      ), ${joinCtes(input)}, ${auditCte("updated", diffEmployee(before, after), actorId)}
      select id from target`);
    const current = (await this.get(id)) as Employee;
    return r.rows[0]
      ? { kind: "ok", employee: current }
      : { kind: "conflict", current };
  }

  async setActive(
    id: string,
    active: boolean,
    version: number,
    actorId: string,
  ): Promise<EmployeeResult> {
    const before = await this.get(id);
    if (!before) return { kind: "not_found" };
    const changes: Changes =
      before.active === active
        ? {}
        : { active: { from: before.active, to: active } };
    const r = await this.db.execute<{ id: string }>(sql`
      with target as (
        update ${employees} set active = ${active}, version = version + 1, updated_at = now()
        where id = ${id} and version = ${version} returning id
      ), ${auditCte(active ? "reactivated" : "deactivated", changes, actorId)}
      select id from target`);
    const current = (await this.get(id)) as Employee;
    return r.rows[0]
      ? { kind: "ok", employee: current }
      : { kind: "conflict", current };
  }

  history(id: string) {
    return historyFor(this.db, ENTITY_TYPE, id);
  }
}

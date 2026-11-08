import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type {
  Absence,
  AbsenceInput,
  AvailabilityRule,
  EmployeeAvailability,
  RuleInput,
  WeekView,
} from "#shared/availability.js";
import { addDays } from "#shared/availability.js";
import {
  absences,
  auditEvents,
  availabilityRules,
  employees,
} from "#shared/db/schema.js";
import type { AuditAction } from "#shared/locations.js";
import type { Db } from "../db/client.js";

export type EntryResult<T> =
  | { kind: "ok"; entry: T }
  | { kind: "conflict"; current: T }
  | { kind: "not_found" };

export interface AvailabilityRepository {
  forEmployee(employeeId: string): Promise<EmployeeAvailability>;
  addAbsence(
    employeeId: string,
    input: AbsenceInput,
    actorId: string,
  ): Promise<Absence>;
  updateAbsence(
    id: string,
    input: AbsenceInput,
    version: number,
    actorId: string,
  ): Promise<EntryResult<Absence>>;
  deleteAbsence(
    id: string,
    version: number,
    actorId: string,
  ): Promise<EntryResult<Absence>>;
  addRule(
    employeeId: string,
    input: RuleInput,
    actorId: string,
  ): Promise<AvailabilityRule>;
  updateRule(
    id: string,
    input: RuleInput,
    version: number,
    actorId: string,
  ): Promise<EntryResult<AvailabilityRule>>;
  deleteRule(
    id: string,
    version: number,
    actorId: string,
  ): Promise<EntryResult<AvailabilityRule>>;
  /** Active employees + absences overlapping [start, start+6] + their rules. */
  week(start: string): Promise<WeekView>;
}

const ABSENCE_COLS = sql`id, employee_id as "employeeId", kind, start_date::text as "startDate", end_date::text as "endDate",
  start_time as "startTime", end_time as "endTime", note, version, updated_at as "updatedAt"`;
const RULE_COLS = sql`id, employee_id as "employeeId", weekdays, start_time as "startTime", end_time as "endTime",
  version, updated_at as "updatedAt"`;

const iso = (v: string | Date) => new Date(v).toISOString();
type Raw<T> = Omit<T, "updatedAt"> & { updatedAt: string };
const toAbsence = (r: Raw<Absence>): Absence => ({
  ...r,
  updatedAt: iso(r.updatedAt),
});
const toRule = (r: Raw<AvailabilityRule>): AvailabilityRule => ({
  ...r,
  updatedAt: iso(r.updatedAt),
});

/** Snapshot stored in the audit entry (no ids/versions). */
const absenceSnap = (a: AbsenceInput | Absence) => ({
  kind: a.kind,
  startDate: a.startDate,
  endDate: a.endDate,
  startTime: a.startTime,
  endTime: a.endTime,
  note: a.note,
});
const ruleSnap = (r: RuleInput | AvailabilityRule) => ({
  weekdays: r.weekdays,
  startTime: r.startTime,
  endTime: r.endTime,
});

/** Audit entry on the EMPLOYEE, hanging off CTE `t` (ADR-015). */
const audit = (
  action: AuditAction,
  from: unknown,
  to: unknown,
  actorId: string,
) => sql`
  a as (insert into ${auditEvents} (id, entity_type, entity_id, action, actor_user_id, changes)
    select ${uuidv7()}, 'employee', t."employeeId", ${action}, ${actorId},
      ${JSON.stringify({ entry: { from, to } })}::jsonb from t)`;

const json = (v: unknown) => sql`${JSON.stringify(v)}::jsonb`;
const weekdaysArray = (w: string[]) =>
  sql`(select array_agg(value order by ordinality) from jsonb_array_elements_text(${json(w)}) with ordinality)`;

export class DrizzleAvailabilityRepository implements AvailabilityRepository {
  constructor(private readonly db: Db) {}

  private async absence(id: string) {
    const r = await this.db.execute<Raw<Absence>>(
      sql`select ${ABSENCE_COLS} from ${absences} where id = ${id}`,
    );
    return r.rows[0] ? toAbsence(r.rows[0]) : null;
  }
  private async rule(id: string) {
    const r = await this.db.execute<Raw<AvailabilityRule>>(
      sql`select ${RULE_COLS} from ${availabilityRules} where id = ${id}`,
    );
    return r.rows[0] ? toRule(r.rows[0]) : null;
  }

  async forEmployee(employeeId: string) {
    const [a, r] = await Promise.all([
      this.db.execute<Raw<Absence>>(
        sql`select ${ABSENCE_COLS} from ${absences} where employee_id = ${employeeId} order by start_date, start_time nulls first, id`,
      ),
      this.db.execute<Raw<AvailabilityRule>>(
        sql`select ${RULE_COLS} from ${availabilityRules} where employee_id = ${employeeId} order by created_at, id`,
      ),
    ]);
    return { absences: a.rows.map(toAbsence), rules: r.rows.map(toRule) };
  }

  async addAbsence(employeeId: string, input: AbsenceInput, actorId: string) {
    const r = await this.db.execute<Raw<Absence>>(sql`
      with t as (
        insert into ${absences} (id, employee_id, kind, start_date, end_date, start_time, end_time, note)
        values (${uuidv7()}, ${employeeId}, ${input.kind}, ${input.startDate}::date, ${input.endDate}::date,
          ${input.startTime}, ${input.endTime}, ${input.note})
        returning ${ABSENCE_COLS}
      ), ${audit("absence_added", null, absenceSnap(input), actorId)}
      select * from t`);
    return toAbsence(r.rows[0] as Raw<Absence>);
  }

  async updateAbsence(
    id: string,
    input: AbsenceInput,
    version: number,
    actorId: string,
  ): Promise<EntryResult<Absence>> {
    const before = await this.absence(id);
    if (!before) return { kind: "not_found" };
    const r = await this.db.execute<Raw<Absence>>(sql`
      with t as (
        update ${absences} set kind = ${input.kind}, start_date = ${input.startDate}::date, end_date = ${input.endDate}::date,
          start_time = ${input.startTime}, end_time = ${input.endTime}, note = ${input.note},
          version = version + 1, updated_at = now()
        where id = ${id} and version = ${version}
        returning ${ABSENCE_COLS}
      ), ${audit("absence_changed", absenceSnap(before), absenceSnap(input), actorId)}
      select * from t`);
    if (r.rows[0]) return { kind: "ok", entry: toAbsence(r.rows[0]) };
    const current = await this.absence(id);
    return current ? { kind: "conflict", current } : { kind: "not_found" };
  }

  async deleteAbsence(
    id: string,
    version: number,
    actorId: string,
  ): Promise<EntryResult<Absence>> {
    const before = await this.absence(id);
    if (!before) return { kind: "not_found" };
    const r = await this.db.execute<Raw<Absence>>(sql`
      with t as (
        delete from ${absences} where id = ${id} and version = ${version} returning ${ABSENCE_COLS}
      ), ${audit("absence_deleted", absenceSnap(before), null, actorId)}
      select * from t`);
    if (r.rows[0]) return { kind: "ok", entry: toAbsence(r.rows[0]) };
    const current = await this.absence(id);
    return current ? { kind: "conflict", current } : { kind: "not_found" };
  }

  async addRule(employeeId: string, input: RuleInput, actorId: string) {
    const r = await this.db.execute<Raw<AvailabilityRule>>(sql`
      with t as (
        insert into ${availabilityRules} (id, employee_id, weekdays, start_time, end_time)
        values (${uuidv7()}, ${employeeId}, ${weekdaysArray(input.weekdays)}, ${input.startTime}, ${input.endTime})
        returning ${RULE_COLS}
      ), ${audit("rule_added", null, ruleSnap(input), actorId)}
      select * from t`);
    return toRule(r.rows[0] as Raw<AvailabilityRule>);
  }

  async updateRule(
    id: string,
    input: RuleInput,
    version: number,
    actorId: string,
  ): Promise<EntryResult<AvailabilityRule>> {
    const before = await this.rule(id);
    if (!before) return { kind: "not_found" };
    const r = await this.db.execute<Raw<AvailabilityRule>>(sql`
      with t as (
        update ${availabilityRules} set weekdays = ${weekdaysArray(input.weekdays)}, start_time = ${input.startTime},
          end_time = ${input.endTime}, version = version + 1, updated_at = now()
        where id = ${id} and version = ${version}
        returning ${RULE_COLS}
      ), ${audit("rule_changed", ruleSnap(before), ruleSnap(input), actorId)}
      select * from t`);
    if (r.rows[0]) return { kind: "ok", entry: toRule(r.rows[0]) };
    const current = await this.rule(id);
    return current ? { kind: "conflict", current } : { kind: "not_found" };
  }

  async deleteRule(
    id: string,
    version: number,
    actorId: string,
  ): Promise<EntryResult<AvailabilityRule>> {
    const before = await this.rule(id);
    if (!before) return { kind: "not_found" };
    const r = await this.db.execute<Raw<AvailabilityRule>>(sql`
      with t as (
        delete from ${availabilityRules} where id = ${id} and version = ${version} returning ${RULE_COLS}
      ), ${audit("rule_deleted", ruleSnap(before), null, actorId)}
      select * from t`);
    if (r.rows[0]) return { kind: "ok", entry: toRule(r.rows[0]) };
    const current = await this.rule(id);
    return current ? { kind: "conflict", current } : { kind: "not_found" };
  }

  async week(start: string): Promise<WeekView> {
    const end = addDays(start, 6);
    const [emps, a, r] = await Promise.all([
      this.db.execute<WeekView["employees"][number]>(sql`
        select id, first_name as "firstName", last_name as "lastName", personnel_no as "personnelNo"
        from ${employees} where active order by lower(last_name), lower(first_name)`),
      this.db.execute<Raw<Absence>>(sql`
        select ${sql.raw('a.id, a.employee_id as "employeeId", a.kind, a.start_date::text as "startDate", a.end_date::text as "endDate", a.start_time as "startTime", a.end_time as "endTime", a.note, a.version, a.updated_at as "updatedAt"')}
        from ${absences} a join ${employees} e on e.id = a.employee_id
        where e.active and a.start_date <= ${end}::date and a.end_date >= ${start}::date
        order by a.start_date, a.start_time nulls first`),
      this.db.execute<Raw<AvailabilityRule>>(sql`
        select ${sql.raw('r.id, r.employee_id as "employeeId", r.weekdays, r.start_time as "startTime", r.end_time as "endTime", r.version, r.updated_at as "updatedAt"')}
        from ${availabilityRules} r join ${employees} e on e.id = r.employee_id
        where e.active order by r.created_at`),
    ]);
    return {
      start,
      employees: emps.rows,
      absences: a.rows.map(toAbsence),
      rules: r.rows.map(toRule),
    };
  }
}

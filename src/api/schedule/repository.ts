import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Absence, AvailabilityRule } from "#shared/availability.js";
import { addDays } from "#shared/availability.js";
import {
  absences,
  auditEvents,
  availabilityRules,
  contractTypes,
  employeeLocations,
  employees,
  locationStaffing,
  locations,
  scheduleCopies,
  shiftAssignments,
  shiftOverrides,
  users,
} from "#shared/db/schema.js";
import type { AuditEntry } from "#shared/locations.js";
import type {
  AssignInput,
  Assignment,
  CopyInput,
  ScheduleCopy,
  ScheduleWeek,
  ShiftOverride,
} from "#shared/schedule.js";
import type { Db } from "../db/client.js";

export const ENTITY_TYPE = "shift_assignment";

export type AssignResult =
  | { kind: "ok"; assignment: Assignment }
  | { kind: "overlap" };
export type RemoveResult =
  | { kind: "ok"; assignment: Assignment }
  | { kind: "conflict"; current: Assignment }
  | { kind: "not_found" };
export type DeactivateResult =
  | { kind: "ok"; removed: number }
  | { kind: "conflict" }
  | { kind: "not_found" };
export type ScheduleHistoryEntry = AuditEntry & { employeeName: string | null };
/** One override write incl. the assignment consequences, as ONE statement. */
export type OverrideWrite = {
  op:
    | {
        type: "insert";
        row: Omit<ShiftOverride, "id" | "version" | "updatedAt">;
      }
    | {
        type: "update";
        id: string;
        version: number;
        set: Pick<ShiftOverride, "kind" | "start" | "end" | "people">;
      }
    | { type: "delete"; id: string; version: number };
  /** assignments that still fit → re-anchored to `anchor` */
  keep: string[];
  anchor: { start: string; end: string } | null;
  /** assignments that no longer fit → removed (confirmed by the planner) */
  remove: Assignment[];
  action:
    | "shift_added"
    | "shift_changed"
    | "shift_cancelled"
    | "shift_reset"
    | "shift_deleted";
  snapshot: Record<string, unknown>;
};
export type OverrideResult =
  | { kind: "ok"; override: ShiftOverride | null }
  | { kind: "conflict"; current: ShiftOverride }
  | { kind: "not_found" }
  | { kind: "already_overridden" };

export type Target = { employeeId: string } | { locationId: string };
export type CreateCopyResult =
  | { kind: "ok"; copy: ScheduleCopy }
  | { kind: "overlap" };
export type UndoCopyResult =
  | { kind: "ok"; removed: number; copy: ScheduleCopy }
  | { kind: "conflict"; current: ScheduleCopy }
  | { kind: "not_found" };

export interface ScheduleRepository {
  week(start: string, today: string): Promise<ScheduleWeek>;
  get(id: string): Promise<Assignment | null>;
  assign(input: AssignInput, actorId: string): Promise<AssignResult>;
  unassign(id: string, version: number, actorId: string): Promise<RemoveResult>;
  history(locationId: string, start: string): Promise<ScheduleHistoryEntry[]>;
  /** Assignments with date > today. */
  futureCount(target: Target, today: string): Promise<number>;
  /** ONE statement: remove assignments after today, audit them, deactivate the employee/location (+ its audit). */
  removeFutureAndDeactivate(
    target: Target,
    version: number,
    today: string,
    actorId: string,
  ): Promise<DeactivateResult>;
  getOverride(id: string): Promise<ShiftOverride | null>;
  writeOverride(write: OverrideWrite, actorId: string): Promise<OverrideResult>;
  /** ONE statement: copy row + all assignments (with copy_id) + their audit rows (Teil 3). */
  createCopy(
    meta: CopyInput,
    inputs: AssignInput[],
    actorId: string,
    today: string,
  ): Promise<CreateCopyResult>;
  /** Latest 20 copies; `remaining` = assignments of the copy from today on. */
  listCopies(today: string): Promise<ScheduleCopy[]>;
  getCopy(id: string, today: string): Promise<ScheduleCopy | null>;
  /** ONE statement: mark undone (version-checked), remove its assignments from today on, audit them. */
  undoCopy(
    id: string,
    version: number,
    today: string,
    actorId: string,
  ): Promise<UndoCopyResult>;
}

const COLS =
  sql.raw(`id, location_id as "locationId", employee_id as "employeeId", date::text as "date",
  start_time as "start", end_time as "end", shift_start as "shiftStart", shift_end as "shiftEnd", version, updated_at as "updatedAt"`);
type Raw<T> = Omit<T, "updatedAt"> & { updatedAt: string | Date };
const iso = (v: string | Date) => new Date(v).toISOString();
const OV_COLS =
  sql.raw(`id, location_id as "locationId", date::text as "date", kind, base_start as "baseStart", base_end as "baseEnd",
  start_time as "start", end_time as "end", people, version, updated_at as "updatedAt"`);
type RawOverride = Omit<ShiftOverride, "updatedAt"> & {
  updatedAt: string | Date;
};
const toOverride = (r: RawOverride): ShiftOverride => ({
  ...r,
  updatedAt: iso(r.updatedAt),
});
function isUnique(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code) === "23505";
}
const toAssignment = (r: Raw<Assignment>): Assignment => ({
  ...r,
  updatedAt: iso(r.updatedAt),
});
const snapshot = (
  a: Pick<
    Assignment,
    "date" | "employeeId" | "start" | "end" | "shiftStart" | "shiftEnd"
  >,
) => ({
  date: a.date,
  employeeId: a.employeeId,
  start: a.start,
  end: a.end,
  shiftStart: a.shiftStart,
  shiftEnd: a.shiftEnd,
});

function isExclusionViolation(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code) === "23P01";
}

type RawCopy = Omit<ScheduleCopy, "createdAt" | "undoneAt"> & {
  createdAt: string | Date;
  undoneAt: string | Date | null;
};
const toCopy = (r: RawCopy): ScheduleCopy => ({
  ...r,
  createdAt: iso(r.createdAt),
  undoneAt: r.undoneAt ? iso(r.undoneAt) : null,
});
const copyCols = (
  today: string,
) => sql`c.id, c.source_start::text as "sourceStart", c.target_starts as "targetStarts",
  c.location_ids as "locationIds", c.copied, c.version, c.created_at as "createdAt", c.undone_at as "undoneAt",
  u.email as "actorEmail",
  (select count(*)::int from ${shiftAssignments} s where s.copy_id = c.id and s.date >= ${today}::date) as remaining`;

export class DrizzleScheduleRepository implements ScheduleRepository {
  constructor(private readonly db: Db) {}

  async week(start: string, today: string): Promise<ScheduleWeek> {
    const end = addDays(start, 6);
    const ovs = await this.db.execute<RawOverride>(sql`
      select ${OV_COLS} from ${shiftOverrides} where date between ${start}::date and ${addDays(start, 6)}::date
      order by date, start_time nulls last`);
    const [locs, asg] = await Promise.all([
      this.db.execute<{
        id: string;
        name: string;
        openingHours: ScheduleWeek["locations"][number]["openingHours"];
        windows: unknown;
      }>(sql`
        select l.id, l.name, l.opening_hours as "openingHours", coalesce(s.windows, '[]'::jsonb) as windows
        from ${locations} l left join ${locationStaffing} s on s.location_id = l.id
        where l.active order by lower(l.name)`),
      this.db.execute<Raw<Assignment>>(sql`
        select ${COLS} from ${shiftAssignments} where date between ${start}::date and ${end}::date
        order by date, start_time`),
    ]);
    const assignments = asg.rows.map(toAssignment);
    const assignedIds = [...new Set(assignments.map((a) => a.employeeId))];
    const emps = await this.db.execute<ScheduleWeek["employees"][number]>(sql`
      select e.id, e.first_name as "firstName", e.last_name as "lastName", e.active, e.is_floater as "isFloater",
        coalesce(e.weekly_minutes_override, ct.weekly_minutes) as "weeklyTarget",
        ct.allowed_shift_minutes as "allowedShiftMinutes", ct.max_daily_minutes as "maxDailyMinutes",
        coalesce((select json_agg(json_build_object('locationId', el.location_id, 'trained', el.trained, 'preference', el.preference))
          from ${employeeLocations} el where el.employee_id = e.id), '[]') as locations
      from ${employees} e join ${contractTypes} ct on ct.id = e.contract_type_id
      where e.active or e.id::text in (select jsonb_array_elements_text(${JSON.stringify(assignedIds)}::jsonb))
      order by lower(e.last_name), lower(e.first_name)`);
    const ids = JSON.stringify(emps.rows.map((e) => e.id));
    const [abs, rules] = await Promise.all([
      this.db.execute<Raw<Absence>>(sql`
        select id, employee_id as "employeeId", kind, start_date::text as "startDate", end_date::text as "endDate",
          start_time as "startTime", end_time as "endTime", note, version, updated_at as "updatedAt"
        from ${absences}
        where employee_id::text in (select jsonb_array_elements_text(${ids}::jsonb))
          and start_date <= ${end}::date and end_date >= ${start}::date`),
      this.db.execute<Raw<AvailabilityRule>>(sql`
        select id, employee_id as "employeeId", weekdays, start_time as "startTime", end_time as "endTime", version, updated_at as "updatedAt"
        from ${availabilityRules} where employee_id::text in (select jsonb_array_elements_text(${ids}::jsonb))`),
    ]);
    return {
      start,
      today,
      locations: locs.rows.map((l) => ({
        id: l.id,
        name: l.name,
        openingHours: l.openingHours,
        staffingWindows:
          l.windows as ScheduleWeek["locations"][number]["staffingWindows"],
      })),
      employees: emps.rows.map((e) => ({
        ...e,
        allowedShiftMinutes: (e.allowedShiftMinutes ?? []).map(Number),
      })),
      assignments,
      absences: abs.rows.map((a) => ({ ...a, updatedAt: iso(a.updatedAt) })),
      rules: rules.rows.map((r) => ({ ...r, updatedAt: iso(r.updatedAt) })),
      overrides: ovs.rows.map(toOverride),
    };
  }

  async get(id: string) {
    const r = await this.db.execute<Raw<Assignment>>(
      sql`select ${COLS} from ${shiftAssignments} where id = ${id}`,
    );
    return r.rows[0] ? toAssignment(r.rows[0]) : null;
  }

  async assign(input: AssignInput, actorId: string): Promise<AssignResult> {
    try {
      const r = await this.db.execute<Raw<Assignment>>(sql`
        with t as (
          insert into ${shiftAssignments} (id, location_id, employee_id, date, start_time, end_time, shift_start, shift_end, created_by)
          values (${uuidv7()}, ${input.locationId}, ${input.employeeId}, ${input.date}::date, ${input.start}, ${input.end},
            ${input.shiftStart}, ${input.shiftEnd}, ${actorId})
          returning ${COLS}
        ), a as (
          insert into ${auditEvents} (id, entity_type, entity_id, action, actor_user_id, changes)
          select ${uuidv7()}, ${ENTITY_TYPE}, t."locationId", 'assigned', ${actorId},
            ${JSON.stringify({ entry: { from: null, to: snapshot(input) } })}::jsonb from t
        )
        select * from t`);
      return {
        kind: "ok",
        assignment: toAssignment(r.rows[0] as Raw<Assignment>),
      };
    } catch (error) {
      if (isExclusionViolation(error)) return { kind: "overlap" };
      throw error;
    }
  }

  async unassign(
    id: string,
    version: number,
    actorId: string,
  ): Promise<RemoveResult> {
    const before = await this.get(id);
    if (!before) return { kind: "not_found" };
    const r = await this.db.execute<Raw<Assignment>>(sql`
      with t as (
        delete from ${shiftAssignments} where id = ${id} and version = ${version} returning ${COLS}
      ), a as (
        insert into ${auditEvents} (id, entity_type, entity_id, action, actor_user_id, changes)
        select ${uuidv7()}, ${ENTITY_TYPE}, t."locationId", 'unassigned', ${actorId},
          ${JSON.stringify({ entry: { from: snapshot(before), to: null } })}::jsonb from t
      )
      select * from t`);
    if (r.rows[0]) return { kind: "ok", assignment: toAssignment(r.rows[0]) };
    const current = await this.get(id);
    return current ? { kind: "conflict", current } : { kind: "not_found" };
  }

  async history(
    locationId: string,
    start: string,
  ): Promise<ScheduleHistoryEntry[]> {
    const end = addDays(start, 6);
    const r = await this.db.execute<{
      id: string;
      action: AuditEntry["action"];
      actorEmail: string | null;
      occurredAt: string | Date;
      changes: AuditEntry["changes"];
      employeeName: string | null;
    }>(sql`
      select a.id, a.action, u.email as "actorEmail", a.occurred_at as "occurredAt", a.changes,
        e.first_name || ' ' || e.last_name as "employeeName"
      from ${auditEvents} a left join ${users} u on u.id = a.actor_user_id
      left join ${employees} e on e.id = (coalesce(a.changes->'entry'->'to'->>'employeeId', a.changes->'entry'->'from'->>'employeeId'))::uuid
      where a.entity_type = ${ENTITY_TYPE} and a.entity_id = ${locationId}
        and coalesce(a.changes->'entry'->'to'->>'date', a.changes->'entry'->'from'->>'date') between ${start} and ${end}
      order by a.occurred_at desc, a.id desc`);
    return r.rows.map((x) => ({ ...x, occurredAt: iso(x.occurredAt) }));
  }

  private where(target: Target) {
    return "employeeId" in target
      ? sql`employee_id = ${target.employeeId}`
      : sql`location_id = ${target.locationId}`;
  }

  async futureCount(target: Target, today: string) {
    const r = await this.db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${shiftAssignments} where ${this.where(target)} and date > ${today}::date`,
    );
    return r.rows[0]?.n ?? 0;
  }

  async removeFutureAndDeactivate(
    target: Target,
    version: number,
    today: string,
    actorId: string,
  ): Promise<DeactivateResult> {
    const isEmployee = "employeeId" in target;
    const table = isEmployee ? employees : locations;
    const id = isEmployee ? target.employeeId : target.locationId;
    const reason = isEmployee ? "employee_deactivated" : "location_deactivated";
    // Audit IDs come from the application (ADR-004): read the affected
    // assignments first and pair each with a v7 id. An assignment created in
    // the tiny window in between survives and shows up as a conflict.
    const future = await this.db.execute<{ id: string }>(
      sql`select id from ${shiftAssignments} where ${this.where(target)} and date > ${today}::date`,
    );
    const pairs = JSON.stringify(
      future.rows.map((r) => ({ a: r.id, audit: uuidv7() })),
    );
    const r = await this.db.execute<{ removed: number; updated: number }>(sql`
      with t as (
        update ${table} set active = false, version = version + 1, updated_at = now()
        where id = ${id} and version = ${version} and active
        returning id
      ), p as (
        select (x->>'a')::uuid as assignment_id, (x->>'audit')::uuid as audit_id from jsonb_array_elements(${pairs}::jsonb) x
      ), d as (
        delete from ${shiftAssignments} s using p
        where s.id = p.assignment_id and exists (select 1 from t)
        returning p.audit_id, s.location_id, s.employee_id, s.date::text as date, s.start_time, s.end_time, s.shift_start, s.shift_end
      ), a1 as (
        insert into ${auditEvents} (id, entity_type, entity_id, action, actor_user_id, changes)
        select ${uuidv7()}::uuid, ${isEmployee ? "employee" : "location"}::text, t.id, 'deactivated', ${actorId}::uuid,
          '{"active":{"from":true,"to":false}}'::jsonb from t
      ), a2 as (
        insert into ${auditEvents} (id, entity_type, entity_id, action, actor_user_id, changes)
        select d.audit_id, ${ENTITY_TYPE}::text, d.location_id, 'unassigned', ${actorId}::uuid,
          jsonb_build_object('entry', jsonb_build_object('from', jsonb_build_object(
            'date', d.date, 'employeeId', d.employee_id, 'start', d.start_time, 'end', d.end_time,
            'shiftStart', d.shift_start, 'shiftEnd', d.shift_end), 'to', null), 'reason', jsonb_build_object('from', null, 'to', ${reason}::text))
        from d
      )
      select (select count(*)::int from d) as removed, (select count(*)::int from t) as updated`);
    const row = r.rows[0];
    if (row && row.updated > 0) return { kind: "ok", removed: row.removed };
    const exists = await this.db.execute(
      sql`select 1 from ${table} where id = ${id}`,
    );
    return exists.rows.length ? { kind: "conflict" } : { kind: "not_found" };
  }

  async getOverride(id: string) {
    const r = await this.db.execute<RawOverride>(
      sql`select ${OV_COLS} from ${shiftOverrides} where id = ${id}`,
    );
    return r.rows[0] ? toOverride(r.rows[0]) : null;
  }

  async writeOverride(
    w: OverrideWrite,
    actorId: string,
  ): Promise<OverrideResult> {
    const op =
      w.op.type === "insert"
        ? sql`insert into ${shiftOverrides} (id, location_id, date, kind, base_start, base_end, start_time, end_time, people, created_by)
            values (${uuidv7()}, ${w.op.row.locationId}, ${w.op.row.date}::date, ${w.op.row.kind}, ${w.op.row.baseStart}::text, ${w.op.row.baseEnd}::text,
              ${w.op.row.start}::text, ${w.op.row.end}::text, ${w.op.row.people}::int, ${actorId})
            returning ${OV_COLS}`
        : w.op.type === "update"
          ? sql`update ${shiftOverrides} set kind = ${w.op.set.kind}, start_time = ${w.op.set.start}::text, end_time = ${w.op.set.end}::text,
              people = ${w.op.set.people}::int, version = version + 1, updated_at = now()
              where id = ${w.op.id} and version = ${w.op.version} returning ${OV_COLS}`
          : sql`delete from ${shiftOverrides} where id = ${w.op.id} and version = ${w.op.version} returning ${OV_COLS}`;
    // Audit IDs from the application (ADR-004).
    const pairs = JSON.stringify(
      w.remove.map((a) => ({ a: a.id, audit: uuidv7() })),
    );
    const anchor = w.anchor ?? { start: null, end: null };
    try {
      const r = await this.db.execute<RawOverride>(sql`
        with o as (${op}),
        k as (
          update ${shiftAssignments} set shift_start = ${anchor.start}::text, shift_end = ${anchor.end}::text,
            version = version + 1, updated_at = now()
          where id::text in (select jsonb_array_elements_text(${JSON.stringify(w.keep)}::jsonb))
            and ${anchor.start}::text is not null and exists (select 1 from o)
        ),
        p as (
          select (x->>'a')::uuid as assignment_id, (x->>'audit')::uuid as audit_id from jsonb_array_elements(${pairs}::jsonb) x
        ),
        d as (
          delete from ${shiftAssignments} s using p where s.id = p.assignment_id and exists (select 1 from o)
          returning p.audit_id, s.location_id, s.employee_id, s.date::text as date, s.start_time, s.end_time, s.shift_start, s.shift_end
        ),
        a1 as (
          insert into ${auditEvents} (id, entity_type, entity_id, action, actor_user_id, changes)
          select ${uuidv7()}::uuid, ${ENTITY_TYPE}::text, o."locationId", ${w.action}::text, ${actorId}::uuid,
            jsonb_build_object('entry', jsonb_build_object('from', null, 'to', ${JSON.stringify(w.snapshot)}::jsonb))
          from o
        ),
        a2 as (
          insert into ${auditEvents} (id, entity_type, entity_id, action, actor_user_id, changes)
          select d.audit_id, ${ENTITY_TYPE}::text, d.location_id, 'unassigned', ${actorId}::uuid,
            jsonb_build_object('entry', jsonb_build_object('from', jsonb_build_object(
              'date', d.date, 'employeeId', d.employee_id, 'start', d.start_time, 'end', d.end_time,
              'shiftStart', d.shift_start, 'shiftEnd', d.shift_end), 'to', null),
              'reason', jsonb_build_object('from', null, 'to', 'shift_changed'))
          from d
        )
        select * from o`);
      const row = r.rows[0];
      if (row)
        return {
          kind: "ok",
          override: w.op.type === "delete" ? null : toOverride(row),
        };
      if (w.op.type === "insert") throw new Error("insert returned no row");
      const current = await this.getOverride(w.op.id);
      return current ? { kind: "conflict", current } : { kind: "not_found" };
    } catch (error) {
      if (isUnique(error)) return { kind: "already_overridden" };
      throw error;
    }
  }

  async createCopy(
    meta: CopyInput,
    inputs: AssignInput[],
    actorId: string,
    today: string,
  ): Promise<CreateCopyResult> {
    const copyId = uuidv7();
    // IDs for assignments and audit rows come from the application (ADR-004).
    const rows = JSON.stringify(
      inputs.map((i) => ({
        id: uuidv7(),
        audit: uuidv7(),
        location_id: i.locationId,
        employee_id: i.employeeId,
        date: i.date,
        start_time: i.start,
        end_time: i.end,
        shift_start: i.shiftStart,
        shift_end: i.shiftEnd,
      })),
    );
    try {
      await this.db.execute(sql`
        with c as (
          insert into ${scheduleCopies} (id, source_start, target_starts, location_ids, copied, created_by)
          values (${copyId}, ${meta.sourceStart}::date, ${JSON.stringify(meta.targetStarts)}::jsonb,
            ${JSON.stringify(meta.locationIds)}::jsonb, ${inputs.length}, ${actorId})
          returning id
        ), r as (
          select * from jsonb_to_recordset(${rows}::jsonb) as x(id uuid, audit uuid, location_id uuid, employee_id uuid,
            date date, start_time text, end_time text, shift_start text, shift_end text)
        ), t as (
          insert into ${shiftAssignments} (id, location_id, employee_id, date, start_time, end_time, shift_start, shift_end, created_by, copy_id)
          select r.id, r.location_id, r.employee_id, r.date, r.start_time, r.end_time, r.shift_start, r.shift_end, ${actorId}::uuid, c.id
          from r cross join c
          returning id
        ), a as (
          insert into ${auditEvents} (id, entity_type, entity_id, action, actor_user_id, changes)
          select r.audit, ${ENTITY_TYPE}::text, r.location_id, 'assigned', ${actorId}::uuid,
            jsonb_build_object('entry', jsonb_build_object('from', null, 'to', jsonb_build_object(
              'date', r.date::text, 'employeeId', r.employee_id, 'start', r.start_time, 'end', r.end_time,
              'shiftStart', r.shift_start, 'shiftEnd', r.shift_end)),
              'reason', jsonb_build_object('from', null, 'to', 'week_copied'))
          from r cross join c
        )
        select (select count(*)::int from t) as n`);
    } catch (error) {
      if (isExclusionViolation(error)) return { kind: "overlap" };
      throw error;
    }
    const copy = await this.getCopy(copyId, today);
    if (!copy) throw new Error("copy vanished after insert");
    return { kind: "ok", copy };
  }

  async listCopies(today: string): Promise<ScheduleCopy[]> {
    const r = await this.db.execute<RawCopy>(sql`
      select ${copyCols(today)} from ${scheduleCopies} c left join ${users} u on u.id = c.created_by
      order by c.created_at desc, c.id desc limit 20`);
    return r.rows.map(toCopy);
  }

  async getCopy(id: string, today: string): Promise<ScheduleCopy | null> {
    const r = await this.db.execute<RawCopy>(sql`
      select ${copyCols(today)} from ${scheduleCopies} c left join ${users} u on u.id = c.created_by
      where c.id = ${id}`);
    return r.rows[0] ? toCopy(r.rows[0]) : null;
  }

  async undoCopy(
    id: string,
    version: number,
    today: string,
    actorId: string,
  ): Promise<UndoCopyResult> {
    // pair each affected assignment with an app-generated audit id (ADR-004)
    const affected = await this.db.execute<{ id: string }>(
      sql`select id from ${shiftAssignments} where copy_id = ${id} and date >= ${today}::date`,
    );
    const pairs = JSON.stringify(
      affected.rows.map((r) => ({ a: r.id, audit: uuidv7() })),
    );
    const r = await this.db.execute<{ removed: number; updated: number }>(sql`
      with t as (
        update ${scheduleCopies} set undone_at = now(), undone_by = ${actorId}, version = version + 1, updated_at = now()
        where id = ${id} and version = ${version} and undone_at is null
        returning id
      ), p as (
        select (x->>'a')::uuid as assignment_id, (x->>'audit')::uuid as audit_id from jsonb_array_elements(${pairs}::jsonb) x
      ), d as (
        delete from ${shiftAssignments} s using p
        where s.id = p.assignment_id and s.copy_id = ${id}::uuid and exists (select 1 from t)
        returning p.audit_id, s.location_id, s.employee_id, s.date::text as date, s.start_time, s.end_time, s.shift_start, s.shift_end
      ), a as (
        insert into ${auditEvents} (id, entity_type, entity_id, action, actor_user_id, changes)
        select d.audit_id, ${ENTITY_TYPE}::text, d.location_id, 'unassigned', ${actorId}::uuid,
          jsonb_build_object('entry', jsonb_build_object('from', jsonb_build_object(
            'date', d.date, 'employeeId', d.employee_id, 'start', d.start_time, 'end', d.end_time,
            'shiftStart', d.shift_start, 'shiftEnd', d.shift_end), 'to', null),
            'reason', jsonb_build_object('from', null, 'to', 'copy_undone'))
        from d
      )
      select (select count(*)::int from d) as removed, (select count(*)::int from t) as updated`);
    const row = r.rows[0];
    const current = await this.getCopy(id, today);
    if (!current) return { kind: "not_found" };
    if (row && row.updated > 0)
      return { kind: "ok", removed: row.removed, copy: current };
    return { kind: "conflict", current };
  }
}

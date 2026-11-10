// In-memory double for the shift plan with the same semantics as the Drizzle
// repository: overlap rule (emulating the exclusion constraint), version-checked
// removal, audit on the location, combined removal + deactivation.
import { v7 as uuidv7 } from "uuid";
import { addDays } from "#shared/availability.js";
import type { AuditEntry } from "#shared/locations.js";
import {
  type AssignInput,
  type Assignment,
  type CopyInput,
  type ScheduleCopy,
  type ScheduleWeek,
  type ShiftOverride,
  toMin,
} from "#shared/schedule.js";
import type {
  AssignResult,
  CreateCopyResult,
  DeactivateResult,
  OverrideResult,
  OverrideWrite,
  RemoveResult,
  ScheduleRepository,
  Target,
  UndoCopyResult,
} from "../schedule/repository.js";
import type { InMemoryAvailabilityRepository } from "./fake-availability.js";
import type {
  InMemoryContractTypeRepository,
  InMemoryEmployeeRepository,
} from "./fake-employees.js";
import type {
  InMemoryLocationRepository,
  InMemoryStaffingRepository,
} from "./fakes.js";

const now = () => new Date().toISOString();
type Logged = AuditEntry & { locationId: string };

export class InMemoryScheduleRepository implements ScheduleRepository {
  rows = new Map<string, Assignment>();
  overrides = new Map<string, ShiftOverride>();
  copies = new Map<string, Omit<ScheduleCopy, "remaining">>();
  /** assignment id → copy id (the DB column copy_id) */
  copyOf = new Map<string, string>();
  audit: Logged[] = [];
  constructor(
    private readonly deps: {
      locations: InMemoryLocationRepository;
      staffing: InMemoryStaffingRepository;
      employees: InMemoryEmployeeRepository;
      contractTypes: InMemoryContractTypeRepository;
      availability: InMemoryAvailabilityRepository;
    },
  ) {}

  private log(
    locationId: string,
    action: "assigned" | "unassigned",
    from: unknown,
    to: unknown,
    reason?: string,
  ) {
    this.audit.push({
      id: uuidv7(),
      locationId,
      action,
      actorEmail: "anke@example.org",
      occurredAt: now(),
      changes: {
        entry: { from, to },
        ...(reason ? { reason: { from: null, to: reason } } : {}),
      },
    });
  }

  async week(start: string, today: string): Promise<ScheduleWeek> {
    const end = addDays(start, 6);
    const assignments = [...this.rows.values()].filter(
      (a) => a.date >= start && a.date <= end,
    );
    const assigned = new Set(assignments.map((a) => a.employeeId));
    const locations = [...this.deps.locations.rows.values()]
      .filter((l) => l.active)
      .map((l) => ({
        id: l.id,
        name: l.name,
        openingHours: l.openingHours,
        staffingWindows: this.deps.staffing.rows.get(l.id)?.windows ?? [],
      }));
    const employees = [...this.deps.employees.rows.values()]
      .filter((e) => e.active || assigned.has(e.id))
      .map((e) => {
        const ct = this.deps.contractTypes.rows.get(e.contractTypeId);
        return {
          id: e.id,
          firstName: e.firstName,
          lastName: e.lastName,
          active: e.active,
          isFloater: e.isFloater,
          weeklyTarget: e.weeklyMinutesOverride ?? ct?.weeklyMinutes ?? 0,
          allowedShiftMinutes: ct?.allowedShiftMinutes ?? [],
          maxDailyMinutes: ct?.maxDailyMinutes ?? null,
          locations: e.locations,
        };
      });
    const ids = new Set(employees.map((e) => e.id));
    return {
      start,
      today,
      locations,
      employees,
      assignments,
      absences: [...this.deps.availability.absences.values()].filter(
        (a) =>
          ids.has(a.employeeId) && a.startDate <= end && a.endDate >= start,
      ),
      rules: [...this.deps.availability.rules.values()].filter((r) =>
        ids.has(r.employeeId),
      ),
      overrides: [...this.overrides.values()].filter(
        (o) => o.date >= start && o.date <= end,
      ),
    };
  }

  async get(id: string) {
    return this.rows.get(id) ?? null;
  }

  async assign(input: AssignInput): Promise<AssignResult> {
    const clash = [...this.rows.values()].some(
      (a) =>
        a.employeeId === input.employeeId &&
        a.date === input.date &&
        toMin(a.start) < toMin(input.end) &&
        toMin(input.start) < toMin(a.end),
    );
    if (clash) return { kind: "overlap" };
    const a: Assignment = {
      id: uuidv7(),
      ...input,
      version: 1,
      updatedAt: now(),
    };
    this.rows.set(a.id, a);
    this.log(a.locationId, "assigned", null, input);
    return { kind: "ok", assignment: a };
  }

  async unassign(id: string, version: number): Promise<RemoveResult> {
    const cur = this.rows.get(id);
    if (!cur) return { kind: "not_found" };
    if (cur.version !== version) return { kind: "conflict", current: cur };
    this.rows.delete(id);
    this.log(cur.locationId, "unassigned", cur, null);
    return { kind: "ok", assignment: cur };
  }

  async history(locationId: string, start: string) {
    const end = addDays(start, 6);
    return this.audit
      .filter((e) => {
        const entry = e.changes.entry as {
          from: { date: string } | null;
          to: { date: string } | null;
        };
        const date = entry.to?.date ?? entry.from?.date ?? "";
        return e.locationId === locationId && date >= start && date <= end;
      })
      .reverse()
      .map(({ locationId: _, ...rest }) => {
        const entry = rest.changes.entry as {
          from: { employeeId: string } | null;
          to: { employeeId: string } | null;
        };
        const e = this.deps.employees.rows.get(
          entry.to?.employeeId ?? entry.from?.employeeId ?? "",
        );
        return {
          ...rest,
          employeeName: e ? `${e.firstName} ${e.lastName}` : null,
        };
      });
  }

  private matches(a: Assignment, target: Target) {
    return "employeeId" in target
      ? a.employeeId === target.employeeId
      : a.locationId === target.locationId;
  }

  async futureCount(target: Target, today: string) {
    return [...this.rows.values()].filter(
      (a) => this.matches(a, target) && a.date > today,
    ).length;
  }

  async removeFutureAndDeactivate(
    target: Target,
    version: number,
    today: string,
    actorId: string,
  ): Promise<DeactivateResult> {
    const result =
      "employeeId" in target
        ? await this.deps.employees.setActive(target.employeeId, false, version)
        : await this.deps.locations.setActive(
            target.locationId,
            false,
            version,
            actorId,
          );
    if (result.kind === "not_found") return { kind: "not_found" };
    if (result.kind !== "ok") return { kind: "conflict" };
    let removed = 0;
    for (const a of [...this.rows.values()]) {
      if (this.matches(a, target) && a.date > today) {
        this.rows.delete(a.id);
        this.log(
          a.locationId,
          "unassigned",
          a,
          null,
          "employeeId" in target
            ? "employee_deactivated"
            : "location_deactivated",
        );
        removed++;
      }
    }
    return { kind: "ok", removed };
  }

  async getOverride(id: string) {
    return this.overrides.get(id) ?? null;
  }

  async writeOverride(w: OverrideWrite): Promise<OverrideResult> {
    let result: ShiftOverride | null = null;
    let locationId: string;
    if (w.op.type === "insert") {
      const row = w.op.row;
      const clash =
        row.kind !== "added" &&
        [...this.overrides.values()].some(
          (o) =>
            o.kind !== "added" &&
            o.locationId === row.locationId &&
            o.date === row.date &&
            o.baseStart === row.baseStart &&
            o.baseEnd === row.baseEnd,
        );
      if (clash) return { kind: "already_overridden" };
      result = { id: uuidv7(), ...row, version: 1, updatedAt: now() };
      this.overrides.set(result.id, result);
      locationId = row.locationId;
    } else {
      const cur = this.overrides.get(w.op.id);
      if (!cur) return { kind: "not_found" };
      if (cur.version !== w.op.version)
        return { kind: "conflict", current: cur };
      locationId = cur.locationId;
      if (w.op.type === "update") {
        result = {
          ...cur,
          ...w.op.set,
          version: cur.version + 1,
          updatedAt: now(),
        };
        this.overrides.set(cur.id, result);
      } else {
        this.overrides.delete(cur.id);
      }
    }
    if (w.anchor) {
      for (const id of w.keep) {
        const a = this.rows.get(id);
        if (a)
          this.rows.set(id, {
            ...a,
            shiftStart: w.anchor.start,
            shiftEnd: w.anchor.end,
            version: a.version + 1,
          });
      }
    }
    for (const a of w.remove) {
      if (this.rows.delete(a.id))
        this.log(a.locationId, "unassigned", a, null, "shift_changed");
    }
    this.audit.push({
      id: uuidv7(),
      locationId,
      action: w.action,
      actorEmail: "anke@example.org",
      occurredAt: now(),
      changes: { entry: { from: null, to: w.snapshot } },
    });
    return { kind: "ok", override: result };
  }

  async createCopy(
    meta: CopyInput,
    inputs: AssignInput[],
    _actorId: string,
    today: string,
  ): Promise<CreateCopyResult> {
    // all-or-nothing like the single statement: check every overlap first
    const all = [...this.rows.values()];
    const planned: AssignInput[] = [];
    for (const i of inputs) {
      const clash = [...all, ...planned].some(
        (a) =>
          a.employeeId === i.employeeId &&
          a.date === i.date &&
          toMin(a.start) < toMin(i.end) &&
          toMin(i.start) < toMin(a.end),
      );
      if (clash) return { kind: "overlap" };
      planned.push(i);
    }
    const copyId = uuidv7();
    this.copies.set(copyId, {
      id: copyId,
      sourceStart: meta.sourceStart,
      targetStarts: meta.targetStarts,
      locationIds: meta.locationIds,
      copied: inputs.length,
      actorEmail: "anke@example.org",
      createdAt: now(),
      undoneAt: null,
      version: 1,
    });
    for (const i of inputs) {
      const a: Assignment = {
        id: uuidv7(),
        ...i,
        version: 1,
        updatedAt: now(),
      };
      this.rows.set(a.id, a);
      this.copyOf.set(a.id, copyId);
      this.log(a.locationId, "assigned", null, i, "week_copied");
    }
    return {
      kind: "ok",
      copy: (await this.getCopy(copyId, today)) as ScheduleCopy,
    };
  }

  private remaining(copyId: string, today: string) {
    return [...this.rows.values()].filter(
      (a) => this.copyOf.get(a.id) === copyId && a.date >= today,
    );
  }

  async listCopies(today: string): Promise<ScheduleCopy[]> {
    return [...this.copies.values()]
      .reverse()
      .slice(0, 20)
      .map((c) => ({ ...c, remaining: this.remaining(c.id, today).length }));
  }

  async getCopy(id: string, today: string): Promise<ScheduleCopy | null> {
    const c = this.copies.get(id);
    return c ? { ...c, remaining: this.remaining(id, today).length } : null;
  }

  async undoCopy(
    id: string,
    version: number,
    today: string,
    _actorId?: string,
  ): Promise<UndoCopyResult> {
    const c = this.copies.get(id);
    if (!c) return { kind: "not_found" };
    if (c.version !== version || c.undoneAt)
      return {
        kind: "conflict",
        current: (await this.getCopy(id, today)) as ScheduleCopy,
      };
    const gone = this.remaining(id, today);
    for (const a of gone) {
      this.rows.delete(a.id);
      this.log(a.locationId, "unassigned", a, null, "copy_undone");
    }
    this.copies.set(id, { ...c, undoneAt: now(), version: c.version + 1 });
    return {
      kind: "ok",
      removed: gone.length,
      copy: (await this.getCopy(id, today)) as ScheduleCopy,
    };
  }
}

// In-memory double for availability with the same semantics as the Drizzle
// repository (version checks, version-checked deletes, audit on the employee).
import { v7 as uuidv7 } from "uuid";
import {
  type Absence,
  type AbsenceInput,
  type AvailabilityRule,
  addDays,
  type RuleInput,
  type WeekView,
} from "#shared/availability.js";
import type { AuditAction } from "#shared/locations.js";
import type {
  AvailabilityRepository,
  EntryResult,
} from "../availability/repository.js";
import type { InMemoryEmployeeRepository } from "./fake-employees.js";

const now = () => new Date().toISOString();

export class InMemoryAvailabilityRepository implements AvailabilityRepository {
  absences = new Map<string, Absence>();
  rules = new Map<string, AvailabilityRule>();
  constructor(private readonly employees: InMemoryEmployeeRepository) {}

  private log(
    employeeId: string,
    action: AuditAction,
    from: unknown,
    to: unknown,
  ) {
    this.employees.audit.push({
      id: uuidv7(),
      entityId: employeeId,
      action,
      actorEmail: "anke@example.org",
      occurredAt: now(),
      changes: { entry: { from, to } },
    });
  }

  async forEmployee(employeeId: string) {
    return {
      absences: [...this.absences.values()]
        .filter((a) => a.employeeId === employeeId)
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
      rules: [...this.rules.values()].filter(
        (r) => r.employeeId === employeeId,
      ),
    };
  }

  async addAbsence(employeeId: string, input: AbsenceInput) {
    const a: Absence = {
      id: uuidv7(),
      employeeId,
      ...input,
      version: 1,
      updatedAt: now(),
    };
    this.absences.set(a.id, a);
    this.log(employeeId, "absence_added", null, input);
    return a;
  }
  async updateAbsence(
    id: string,
    input: AbsenceInput,
    version: number,
  ): Promise<EntryResult<Absence>> {
    const cur = this.absences.get(id);
    if (!cur) return { kind: "not_found" };
    if (cur.version !== version) return { kind: "conflict", current: cur };
    const next = { ...cur, ...input, version: version + 1, updatedAt: now() };
    this.absences.set(id, next);
    this.log(cur.employeeId, "absence_changed", cur, input);
    return { kind: "ok", entry: next };
  }
  async deleteAbsence(
    id: string,
    version: number,
  ): Promise<EntryResult<Absence>> {
    const cur = this.absences.get(id);
    if (!cur) return { kind: "not_found" };
    if (cur.version !== version) return { kind: "conflict", current: cur };
    this.absences.delete(id);
    this.log(cur.employeeId, "absence_deleted", cur, null);
    return { kind: "ok", entry: cur };
  }

  async addRule(employeeId: string, input: RuleInput) {
    const r: AvailabilityRule = {
      id: uuidv7(),
      employeeId,
      ...input,
      version: 1,
      updatedAt: now(),
    };
    this.rules.set(r.id, r);
    this.log(employeeId, "rule_added", null, input);
    return r;
  }
  async updateRule(
    id: string,
    input: RuleInput,
    version: number,
  ): Promise<EntryResult<AvailabilityRule>> {
    const cur = this.rules.get(id);
    if (!cur) return { kind: "not_found" };
    if (cur.version !== version) return { kind: "conflict", current: cur };
    const next = { ...cur, ...input, version: version + 1, updatedAt: now() };
    this.rules.set(id, next);
    this.log(cur.employeeId, "rule_changed", cur, input);
    return { kind: "ok", entry: next };
  }
  async deleteRule(
    id: string,
    version: number,
  ): Promise<EntryResult<AvailabilityRule>> {
    const cur = this.rules.get(id);
    if (!cur) return { kind: "not_found" };
    if (cur.version !== version) return { kind: "conflict", current: cur };
    this.rules.delete(id);
    this.log(cur.employeeId, "rule_deleted", cur, null);
    return { kind: "ok", entry: cur };
  }

  async week(start: string): Promise<WeekView> {
    const end = addDays(start, 6);
    const active = [...this.employees.rows.values()]
      .filter((e) => e.active)
      .sort(
        (a, b) =>
          a.lastName.localeCompare(b.lastName) ||
          a.firstName.localeCompare(b.firstName),
      );
    const ids = new Set(active.map((e) => e.id));
    return {
      start,
      employees: active.map(({ id, firstName, lastName, personnelNo }) => ({
        id,
        firstName,
        lastName,
        personnelNo,
      })),
      absences: [...this.absences.values()].filter(
        (a) =>
          ids.has(a.employeeId) && a.startDate <= end && a.endDate >= start,
      ),
      rules: [...this.rules.values()].filter((r) => ids.has(r.employeeId)),
    };
  }
}

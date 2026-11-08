// In-memory doubles for catalogs and employees with the same semantics as the
// Drizzle repositories (version checks, name uniqueness, in-use lock, kept
// rows for inactive locations, PII-free audit diff).
import { v7 as uuidv7 } from "uuid";
import {
  type CatalogEntry,
  type ContractType,
  type ContractTypeInput,
  hoursChanged,
} from "#shared/catalogs.js";
import type { Employee, EmployeeInput } from "#shared/employees.js";
import type { AuditAction, AuditEntry } from "#shared/locations.js";
import { type Changes, diffFields } from "../audit/history.js";
import type {
  CatalogRepository,
  CatalogResult,
  ContractTypeRepository,
} from "../catalogs/repository.js";
import { diffEmployee } from "../employees/diff.js";
import type {
  EmployeeRepository,
  EmployeeResult,
} from "../employees/repository.js";
import type { LocationRepository } from "../locations/repository.js";

const now = () => new Date().toISOString();
const nameKey = (s: string) => s.toLowerCase();

export class InMemoryCatalogRepository implements CatalogRepository {
  rows = new Map<string, CatalogEntry>();
  async list() {
    return [...this.rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  private taken(name: string, except?: string) {
    return [...this.rows.values()].some(
      (r) => r.id !== except && nameKey(r.name) === nameKey(name),
    );
  }
  async create(name: string): Promise<CatalogResult<CatalogEntry>> {
    if (this.taken(name)) return { kind: "name_taken" };
    const entry = {
      id: uuidv7(),
      name,
      active: true,
      version: 1,
      updatedAt: now(),
    };
    this.rows.set(entry.id, entry);
    return { kind: "ok", entry };
  }
  private write(
    id: string,
    version: number,
    patch: Partial<CatalogEntry>,
  ): CatalogResult<CatalogEntry> {
    const cur = this.rows.get(id);
    if (!cur) return { kind: "not_found" };
    if (patch.name !== undefined && this.taken(patch.name, id))
      return { kind: "name_taken" };
    if (cur.version !== version) return { kind: "conflict", current: cur };
    const next = {
      ...cur,
      ...patch,
      version: cur.version + 1,
      updatedAt: now(),
    };
    this.rows.set(id, next);
    return { kind: "ok", entry: next };
  }
  async rename(id: string, name: string, version: number) {
    return this.write(id, version, { name });
  }
  async setActive(id: string, active: boolean, version: number) {
    return this.write(id, version, { active });
  }
}

export class InMemoryContractTypeRepository implements ContractTypeRepository {
  rows = new Map<string, Omit<ContractType, "inUse">>();
  constructor(private readonly usedBy: (id: string) => boolean) {}
  private view(r: Omit<ContractType, "inUse">): ContractType {
    return { ...r, inUse: this.usedBy(r.id) };
  }
  async list() {
    return [...this.rows.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => this.view(r));
  }
  private taken(name: string, except?: string) {
    return [...this.rows.values()].some(
      (r) => r.id !== except && nameKey(r.name) === nameKey(name),
    );
  }
  async create(input: ContractTypeInput): Promise<CatalogResult<ContractType>> {
    if (this.taken(input.name)) return { kind: "name_taken" };
    const row = {
      id: uuidv7(),
      ...input,
      active: true,
      version: 1,
      updatedAt: now(),
    };
    this.rows.set(row.id, row);
    return { kind: "ok", entry: this.view(row) };
  }
  async update(
    id: string,
    input: ContractTypeInput,
    version: number,
  ): Promise<CatalogResult<ContractType>> {
    const cur = this.rows.get(id);
    if (!cur) return { kind: "not_found" };
    if (this.taken(input.name, id)) return { kind: "name_taken" };
    if (cur.version !== version)
      return { kind: "conflict", current: this.view(cur) };
    if (this.usedBy(id) && hoursChanged(cur, input))
      return { kind: "in_use", current: this.view(cur) };
    const next = {
      ...cur,
      ...input,
      version: cur.version + 1,
      updatedAt: now(),
    };
    this.rows.set(id, next);
    return { kind: "ok", entry: this.view(next) };
  }
  async setActive(
    id: string,
    active: boolean,
    version: number,
  ): Promise<CatalogResult<ContractType>> {
    const cur = this.rows.get(id);
    if (!cur) return { kind: "not_found" };
    if (cur.version !== version)
      return { kind: "conflict", current: this.view(cur) };
    const next = { ...cur, active, version: cur.version + 1, updatedAt: now() };
    this.rows.set(id, next);
    return { kind: "ok", entry: this.view(next) };
  }
}

export class InMemoryEmployeeRepository implements EmployeeRepository {
  rows = new Map<string, Employee>();
  audit: (AuditEntry & { entityId: string })[] = [];
  constructor(private readonly locations: LocationRepository) {}

  async list() {
    return [...this.rows.values()];
  }
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  private log(entityId: string, action: AuditAction, changes: Changes) {
    this.audit.push({
      id: uuidv7(),
      entityId,
      action,
      actorEmail: "anke@example.org",
      occurredAt: now(),
      changes,
    });
  }
  private async merged(
    before: Employee | null,
    input: EmployeeInput,
  ): Promise<EmployeeInput> {
    if (!before) return input;
    const inactive = new Set(
      (await this.locations.list({ includeInactive: true }))
        .filter((l) => !l.active)
        .map((l) => l.id),
    );
    const kept = before.locations.filter((l) => inactive.has(l.locationId));
    const locations = [...input.locations, ...kept].sort((a, b) =>
      a.locationId.localeCompare(b.locationId),
    );
    return { ...input, locations };
  }
  async create(input: EmployeeInput): Promise<EmployeeResult> {
    const employee: Employee = {
      id: uuidv7(),
      ...input,
      active: true,
      version: 1,
      updatedAt: now(),
    };
    this.rows.set(employee.id, employee);
    this.log(employee.id, "created", diffEmployee(null, input));
    return { kind: "ok", employee };
  }
  async update(
    id: string,
    input: EmployeeInput,
    version: number,
  ): Promise<EmployeeResult> {
    const cur = this.rows.get(id);
    if (!cur) return { kind: "not_found" };
    if (cur.version !== version) return { kind: "conflict", current: cur };
    const after = await this.merged(cur, input);
    const next: Employee = {
      ...cur,
      ...after,
      version: cur.version + 1,
      updatedAt: now(),
    };
    this.rows.set(id, next);
    this.log(id, "updated", diffEmployee(cur, after));
    return { kind: "ok", employee: next };
  }
  async setActive(
    id: string,
    active: boolean,
    version: number,
  ): Promise<EmployeeResult> {
    const cur = this.rows.get(id);
    if (!cur) return { kind: "not_found" };
    if (cur.version !== version) return { kind: "conflict", current: cur };
    const next = { ...cur, active, version: cur.version + 1, updatedAt: now() };
    this.rows.set(id, next);
    this.log(
      id,
      active ? "reactivated" : "deactivated",
      diffFields(cur, next, ["active"]),
    );
    return { kind: "ok", employee: next };
  }
  async history(id: string) {
    return this.audit
      .filter((a) => a.entityId === id)
      .reverse()
      .map(({ entityId: _, ...entry }) => entry);
  }
}

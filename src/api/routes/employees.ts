import { type Context, Hono } from "hono";
import {
  type Employee,
  EmployeeInput,
  EmployeeUpdate,
} from "#shared/employees.js";
import { VersionOnly } from "#shared/locations.js";
import { requirePermission } from "../auth/middleware.js";
import type {
  CatalogRepository,
  ContractTypeRepository,
} from "../catalogs/repository.js";
import type {
  EmployeeRepository,
  EmployeeResult,
} from "../employees/repository.js";
import type { LocationRepository } from "../locations/repository.js";
import type { AppEnv } from "../types.js";
import { parseJson } from "../validation.js";
import { EMPLOYEES_MANAGE, notFound, UUID } from "./catalogs.js";

type Deps = {
  employees: EmployeeRepository;
  contractTypes: ContractTypeRepository;
  qualifications: CatalogRepository;
  systemAccesses: CatalogRepository;
  locations: LocationRepository;
};

type Issue = { field: string; message: string };

function respond(
  c: Context<AppEnv>,
  result: EmployeeResult,
  okStatus: 200 | 201 = 200,
) {
  switch (result.kind) {
    case "ok":
      return c.json(result.employee, okStatus);
    case "conflict":
      return c.json(
        {
          error: "version_conflict",
          current: result.current,
          requestId: c.get("requestId"),
        },
        409,
      );
    case "not_found":
      return notFound(c);
  }
}

/**
 * References must exist; NEW assignments must be active. Entries the employee
 * already had may stay even if deactivated since. Rows for inactive locations
 * are dropped here — the repository keeps the stored ones untouched.
 */
async function checkReferences(
  deps: Deps,
  input: EmployeeInput,
  before: Employee | null,
) {
  const issues: Issue[] = [];
  const [types, quals, systems, locs] = await Promise.all([
    deps.contractTypes.list(),
    deps.qualifications.list(),
    deps.systemAccesses.list(),
    deps.locations.list({ includeInactive: true }),
  ]);
  const ok = (
    list: { id: string; active: boolean }[],
    id: string,
    had: boolean,
  ) => {
    const entry = list.find((x) => x.id === id);
    return entry !== undefined && (entry.active || had);
  };
  if (
    !ok(
      types,
      input.contractTypeId,
      before?.contractTypeId === input.contractTypeId,
    )
  ) {
    issues.push({
      field: "contractTypeId",
      message: "Unbekannter oder deaktivierter Vertragstyp.",
    });
  }
  input.qualificationIds.forEach((id, i) => {
    if (!ok(quals, id, before?.qualificationIds.includes(id) ?? false))
      issues.push({
        field: `qualificationIds.${i}`,
        message: "Unbekannte oder deaktivierte Qualifikation.",
      });
  });
  input.systemAccessIds.forEach((id, i) => {
    if (!ok(systems, id, before?.systemAccessIds.includes(id) ?? false))
      issues.push({
        field: `systemAccessIds.${i}`,
        message: "Unbekannter oder deaktivierter Systemzugang.",
      });
  });
  const activeLocations = new Set(
    locs.filter((l) => l.active).map((l) => l.id),
  );
  const known = new Set(locs.map((l) => l.id));
  input.locations.forEach((l, i) => {
    if (!known.has(l.locationId))
      issues.push({
        field: `locations.${i}.locationId`,
        message: "Unbekannter Standort.",
      });
  });
  const cleaned: EmployeeInput = {
    ...input,
    locations: input.locations.filter((l) => activeLocations.has(l.locationId)),
  };
  return { issues, cleaned };
}

/** Mounted behind requireAuth; everything needs `employees.manage` (ADR-010). */
export function employeeRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  app.use("/employees", requirePermission(EMPLOYEES_MANAGE));
  app.use("/employees/*", requirePermission(EMPLOYEES_MANAGE));

  const invalid = (c: Context<AppEnv>, issues: Issue[]) =>
    c.json(
      { error: "invalid_reference", issues, requestId: c.get("requestId") },
      400,
    );

  app.get("/employees", async (c) =>
    c.json({ employees: await deps.employees.list() }, 200),
  );

  app.post("/employees", async (c) => {
    const parsed = await parseJson(c, EmployeeInput);
    if ("response" in parsed) return parsed.response;
    const { issues, cleaned } = await checkReferences(deps, parsed.data, null);
    if (issues.length) return invalid(c, issues);
    return respond(
      c,
      await deps.employees.create(cleaned, c.get("auth").userId),
      201,
    );
  });

  app.get("/employees/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const employee = await deps.employees.get(id);
    return employee ? c.json(employee, 200) : notFound(c);
  });

  app.put("/employees/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const parsed = await parseJson(c, EmployeeUpdate);
    if ("response" in parsed) return parsed.response;
    const before = await deps.employees.get(id);
    if (!before) return notFound(c);
    const { version, ...input } = parsed.data;
    const { issues, cleaned } = await checkReferences(deps, input, before);
    if (issues.length) return invalid(c, issues);
    return respond(
      c,
      await deps.employees.update(id, cleaned, version, c.get("auth").userId),
    );
  });

  for (const [action, active] of [
    ["deactivate", false],
    ["reactivate", true],
  ] as const) {
    app.post(`/employees/:id/${action}`, async (c) => {
      const id = c.req.param("id");
      if (!UUID.test(id)) return notFound(c);
      const parsed = await parseJson(c, VersionOnly);
      if ("response" in parsed) return parsed.response;
      return respond(
        c,
        await deps.employees.setActive(
          id,
          active,
          parsed.data.version,
          c.get("auth").userId,
        ),
      );
    });
  }

  app.get("/employees/:id/history", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    if (!(await deps.employees.get(id))) return notFound(c);
    return c.json({ entries: await deps.employees.history(id) }, 200);
  });

  return app;
}

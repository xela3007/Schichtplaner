import { type Context, Hono } from "hono";
import {
  AbsenceInput,
  AbsenceUpdate,
  IsoDate,
  mondayOf,
  RuleInput,
  RuleUpdate,
} from "#shared/availability.js";
import { requirePermission } from "../auth/middleware.js";
import type {
  AvailabilityRepository,
  EntryResult,
} from "../availability/repository.js";
import type { EmployeeRepository } from "../employees/repository.js";
import type { AppEnv } from "../types.js";
import { parseJson } from "../validation.js";
import { notFound, UUID } from "./catalogs.js";

export const AVAILABILITY_MANAGE = "availability.manage";

function respond<T>(
  c: Context<AppEnv>,
  result: EntryResult<T>,
  deleted = false,
) {
  switch (result.kind) {
    case "ok":
      return deleted ? c.body(null, 204) : c.json(result.entry as object, 200);
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

function versionParam(c: Context<AppEnv>): number | null {
  const v = Number(c.req.query("version"));
  return Number.isInteger(v) && v > 0 ? v : null;
}

/** Absences, recurring rules and the week overview. Mounted behind requireAuth; all need availability.manage. */
export function availabilityRoutes(
  repo: AvailabilityRepository,
  employees: EmployeeRepository,
) {
  const app = new Hono<AppEnv>();
  for (const p of [
    "/absences",
    "/availability-rules",
    "/availability",
    "/employees/:id/availability",
    "/employees/:id/absences",
    "/employees/:id/availability-rules",
  ]) {
    app.use(p, requirePermission(AVAILABILITY_MANAGE));
    app.use(`${p}/*`, requirePermission(AVAILABILITY_MANAGE));
  }
  const badVersion = (c: Context<AppEnv>) =>
    c.json(
      {
        error: "validation_failed",
        issues: [{ field: "version", message: "Version fehlt." }],
        requestId: c.get("requestId"),
      },
      400,
    );

  async function employeeExists(id: string) {
    return UUID.test(id) && (await employees.get(id)) !== null;
  }

  app.get("/employees/:id/availability", async (c) => {
    const id = c.req.param("id");
    if (!(await employeeExists(id))) return notFound(c);
    return c.json(await repo.forEmployee(id), 200);
  });

  app.post("/employees/:id/absences", async (c) => {
    const id = c.req.param("id");
    if (!(await employeeExists(id))) return notFound(c);
    const parsed = await parseJson(c, AbsenceInput);
    if ("response" in parsed) return parsed.response;
    return c.json(
      await repo.addAbsence(id, parsed.data, c.get("auth").userId),
      201,
    );
  });

  app.put("/absences/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const parsed = await parseJson(c, AbsenceUpdate);
    if ("response" in parsed) return parsed.response;
    const { version, ...input } = parsed.data;
    return respond(
      c,
      await repo.updateAbsence(id, input, version, c.get("auth").userId),
    );
  });

  app.delete("/absences/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const version = versionParam(c);
    if (version === null) return badVersion(c);
    return respond(
      c,
      await repo.deleteAbsence(id, version, c.get("auth").userId),
      true,
    );
  });

  app.post("/employees/:id/availability-rules", async (c) => {
    const id = c.req.param("id");
    if (!(await employeeExists(id))) return notFound(c);
    const parsed = await parseJson(c, RuleInput);
    if ("response" in parsed) return parsed.response;
    return c.json(
      await repo.addRule(id, parsed.data, c.get("auth").userId),
      201,
    );
  });

  app.put("/availability-rules/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const parsed = await parseJson(c, RuleUpdate);
    if ("response" in parsed) return parsed.response;
    const { version, ...input } = parsed.data;
    return respond(
      c,
      await repo.updateRule(id, input, version, c.get("auth").userId),
    );
  });

  app.delete("/availability-rules/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const version = versionParam(c);
    if (version === null) return badVersion(c);
    return respond(
      c,
      await repo.deleteRule(id, version, c.get("auth").userId),
      true,
    );
  });

  app.get("/availability/week", async (c) => {
    const start = IsoDate.safeParse(c.req.query("start"));
    if (!start.success) {
      return c.json(
        {
          error: "validation_failed",
          issues: [{ field: "start", message: "Kein gültiges Datum." }],
          requestId: c.get("requestId"),
        },
        400,
      );
    }
    return c.json(await repo.week(mondayOf(start.data)), 200);
  });

  return app;
}

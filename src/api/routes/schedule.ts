import { type Context, Hono } from "hono";
import { IsoDate, mondayOf } from "#shared/availability.js";
import {
  AssignInput,
  DeactivateBody,
  evaluateCandidate,
  insideOpening,
  todayInBerlin,
} from "#shared/schedule.js";
import { requirePermission } from "../auth/middleware.js";
import type { ScheduleRepository, Target } from "../schedule/repository.js";
import type { AppEnv } from "../types.js";
import { parseJson } from "../validation.js";
import { notFound, UUID } from "./catalogs.js";

export const SCHEDULE_MANAGE = "schedule.manage";

const badDate = (c: Context<AppEnv>, field: string) =>
  c.json(
    {
      error: "validation_failed",
      issues: [{ field, message: "Kein gültiges Datum." }],
      requestId: c.get("requestId"),
    },
    400,
  );

/** Schichtplan (Teil 1). Mounted behind requireAuth; everything needs schedule.manage (ADR-010). */
export function scheduleRoutes(
  repo: ScheduleRepository,
  today: () => string = () => todayInBerlin(),
) {
  const app = new Hono<AppEnv>();
  app.use("/schedule", requirePermission(SCHEDULE_MANAGE));
  app.use("/schedule/*", requirePermission(SCHEDULE_MANAGE));

  app.get("/schedule/week", async (c) => {
    const start = IsoDate.safeParse(c.req.query("start"));
    if (!start.success) return badDate(c, "start");
    return c.json(await repo.week(mondayOf(start.data), today()), 200);
  });

  app.post("/schedule/assignments", async (c) => {
    const parsed = await parseJson(c, AssignInput);
    if ("response" in parsed) return parsed.response;
    const input = parsed.data;
    // The week payload is the rule context — same data the UI evaluated.
    const week = await repo.week(mondayOf(input.date), today());
    const employee = week.employees.find(
      (e) => e.id === input.employeeId && e.active,
    );
    const location = week.locations.find((l) => l.id === input.locationId);
    if (!employee || !location) return notFound(c);
    if (!insideOpening(location, input.date, input.start, input.end)) {
      return c.json(
        {
          error: "validation_failed",
          issues: [
            { field: "start", message: "Liegt außerhalb der Öffnungszeiten." },
          ],
          requestId: c.get("requestId"),
        },
        400,
      );
    }
    const { blocks } = evaluateCandidate(
      {
        today: week.today,
        employee,
        locationId: location.id,
        locationNames: Object.fromEntries(
          week.locations.map((l) => [l.id, l.name]),
        ),
        absences: week.absences,
        rules: week.rules,
        assignments: week.assignments,
      },
      input,
    );
    if (blocks.length > 0) {
      return c.json(
        {
          error: "assignment_blocked",
          reasons: blocks,
          requestId: c.get("requestId"),
        },
        400,
      );
    }
    const result = await repo.assign(input, c.get("auth").userId);
    if (result.kind === "overlap") {
      return c.json(
        {
          error: "overlap",
          reasons: [
            {
              code: "overlap",
              message: "Gleichzeitig schon anders eingeteilt.",
            },
          ],
          requestId: c.get("requestId"),
        },
        409,
      );
    }
    return c.json(result.assignment, 201);
  });

  app.delete("/schedule/assignments/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const version = Number(c.req.query("version"));
    if (!Number.isInteger(version) || version < 1) {
      return c.json(
        {
          error: "validation_failed",
          issues: [{ field: "version", message: "Version fehlt." }],
          requestId: c.get("requestId"),
        },
        400,
      );
    }
    const current = await repo.get(id);
    if (!current) return notFound(c);
    if (current.date < today()) {
      return c.json(
        {
          error: "assignment_blocked",
          reasons: [
            { code: "past", message: "Tag liegt in der Vergangenheit" },
          ],
          requestId: c.get("requestId"),
        },
        400,
      );
    }
    const result = await repo.unassign(id, version, c.get("auth").userId);
    if (result.kind === "ok") return c.body(null, 204);
    if (result.kind === "conflict") {
      return c.json(
        {
          error: "version_conflict",
          current: result.current,
          requestId: c.get("requestId"),
        },
        409,
      );
    }
    return notFound(c);
  });

  app.get("/schedule/history", async (c) => {
    const locationId = c.req.query("locationId") ?? "";
    if (!UUID.test(locationId)) return notFound(c);
    const start = IsoDate.safeParse(c.req.query("start"));
    if (!start.success) return badDate(c, "start");
    return c.json(
      { entries: await repo.history(locationId, mondayOf(start.data)) },
      200,
    );
  });

  return app;
}

/**
 * Deactivation gate for employees and locations (story a238fced): with
 * assignments after today the caller must confirm `removeAssignments`; that
 * path also needs schedule.manage and runs as ONE statement. Returns a
 * response to send, or `null` to continue with the normal deactivation.
 */
export async function deactivationGate(
  c: Context<AppEnv>,
  schedule: ScheduleRepository,
  target: Target,
  today: () => string = () => todayInBerlin(),
): Promise<
  { response: Response } | { proceed: { version: number } } | { done: true }
> {
  const parsed = await parseJson(c, DeactivateBody);
  if ("response" in parsed) return parsed;
  const { version, removeAssignments } = parsed.data;
  const count = await schedule.futureCount(target, today());
  if (count === 0) return { proceed: { version } };
  if (!removeAssignments) {
    return {
      response: c.json(
        { error: "has_assignments", count, requestId: c.get("requestId") },
        409,
      ),
    };
  }
  if (!c.get("auth").permissions.includes(SCHEDULE_MANAGE)) {
    return {
      response: c.json(
        { error: "forbidden", requestId: c.get("requestId") },
        403,
      ),
    };
  }
  const result = await schedule.removeFutureAndDeactivate(
    target,
    version,
    today(),
    c.get("auth").userId,
  );
  if (result.kind === "not_found") return { response: notFound(c) };
  if (result.kind === "conflict") {
    return {
      response: c.json(
        { error: "version_conflict", requestId: c.get("requestId") },
        409,
      ),
    };
  }
  // deactivated together with the removal — the route returns the entity
  return { done: true };
}

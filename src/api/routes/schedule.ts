import { type Context, Hono } from "hono";
import { IsoDate, mondayOf } from "#shared/availability.js";
import {
  AssignInput,
  type Assignment,
  affectedAssignments,
  assignmentWindowOk,
  DeactivateBody,
  effectiveShifts,
  evaluateCandidate,
  OverrideInput,
  OverrideUpdate,
  type ScheduleWeek,
  type ShiftOverride,
  todayInBerlin,
} from "#shared/schedule.js";
import { requirePermission } from "../auth/middleware.js";
import type {
  OverrideResult,
  OverrideWrite,
  ScheduleRepository,
  Target,
} from "../schedule/repository.js";
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
    const anchorExists = effectiveShifts(
      location,
      input.date,
      week.overrides,
    ).shifts.some(
      (sh) => sh.start === input.shiftStart && sh.end === input.shiftEnd,
    );
    if (!anchorExists) {
      return c.json(
        {
          error: "unknown_shift",
          reasons: [
            {
              code: "unknown_shift",
              message: "Diese Schicht gibt es an dem Tag nicht (mehr).",
            },
          ],
          requestId: c.get("requestId"),
        },
        400,
      );
    }
    // inside the opening hours, or inside an (added/changed) shift outside them (Teil 2)
    if (!assignmentWindowOk(location, week.overrides, input)) {
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

  // --- Day overrides (Teil 2) -------------------------------------------------------
  const past = (c: Context<AppEnv>) =>
    c.json(
      {
        error: "assignment_blocked",
        reasons: [{ code: "past", message: "Tag liegt in der Vergangenheit" }],
        requestId: c.get("requestId"),
      },
      400,
    );
  const unknownShift = (c: Context<AppEnv>) =>
    c.json(
      {
        error: "unknown_shift",
        reasons: [
          {
            code: "unknown_shift",
            message: "Diese Schicht gibt es an dem Tag nicht (mehr).",
          },
        ],
        requestId: c.get("requestId"),
      },
      400,
    );

  /** Confirmation rule shared by create/update/delete: listed removals need removeAssignments. */
  async function apply(
    c: Context<AppEnv>,
    week: ScheduleWeek,
    write: OverrideWrite,
    confirmed: boolean | undefined,
    okStatus: 200 | 201 | 204,
  ) {
    if (write.remove.length > 0 && !confirmed) {
      return c.json(
        {
          error: "has_assignments",
          count: write.remove.length,
          names: names(week, write.remove),
          requestId: c.get("requestId"),
        },
        409,
      );
    }
    return respondOverride(
      c,
      await repo.writeOverride(write, c.get("auth").userId),
      okStatus,
    );
  }

  app.post("/schedule/overrides", async (c) => {
    const parsed = await parseJson(c, OverrideInput);
    if ("response" in parsed) return parsed.response;
    const input = parsed.data;
    if (input.date < today()) return past(c);
    const week = await repo.week(mondayOf(input.date), today());
    const location = week.locations.find((l) => l.id === input.locationId);
    if (!location) return notFound(c);
    if (input.kind === "added") {
      const row = {
        locationId: input.locationId,
        date: input.date,
        kind: "added" as const,
        baseStart: null,
        baseEnd: null,
        start: input.start,
        end: input.end,
        people: input.people,
      };
      return apply(
        c,
        week,
        {
          op: { type: "insert", row },
          keep: [],
          anchor: null,
          remove: [],
          action: "shift_added",
          snapshot: snapshot(row),
        },
        input.removeAssignments,
        201,
      );
    }
    const base = { start: input.baseStart, end: input.baseEnd };
    const day = effectiveShifts(
      { staffingWindows: location.staffingWindows },
      input.date,
    ).shifts;
    if (!day.some((sh) => sh.start === base.start && sh.end === base.end))
      return unknownShift(c);
    const to =
      input.kind === "changed" ? { start: input.start, end: input.end } : null;
    const { keep, remove } = affectedAssignments(
      week.assignments,
      location.id,
      input.date,
      base,
      to,
    );
    const row = {
      locationId: input.locationId,
      date: input.date,
      kind: input.kind,
      baseStart: base.start,
      baseEnd: base.end,
      start: input.kind === "changed" ? input.start : null,
      end: input.kind === "changed" ? input.end : null,
      people: input.kind === "changed" ? input.people : null,
    };
    return apply(
      c,
      week,
      {
        op: { type: "insert", row },
        keep: keep.map((a) => a.id),
        anchor: to,
        remove,
        action: input.kind === "changed" ? "shift_changed" : "shift_cancelled",
        snapshot: snapshot(row),
      },
      input.removeAssignments,
      201,
    );
  });

  app.put("/schedule/overrides/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const parsed = await parseJson(c, OverrideUpdate);
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    const cur = await repo.getOverride(id);
    if (!cur) return notFound(c);
    if (cur.date < today()) return past(c);
    const week = await repo.week(mondayOf(cur.date), today());
    const anchorOld =
      cur.kind === "cancelled"
        ? null
        : { start: cur.start as string, end: cur.end as string };
    let set: Pick<ShiftOverride, "kind" | "start" | "end" | "people">;
    let to: { start: string; end: string } | null;
    if ("cancelled" in body) {
      if (cur.kind === "added") {
        return c.json(
          {
            error: "validation_failed",
            issues: [
              {
                field: "cancelled",
                message:
                  "Zusätzliche Schichten werden gelöscht, nicht abgesagt.",
              },
            ],
            requestId: c.get("requestId"),
          },
          400,
        );
      }
      set = { kind: "cancelled", start: null, end: null, people: null };
      to = null;
    } else {
      set = {
        kind: cur.kind === "added" ? "added" : "changed",
        start: body.start,
        end: body.end,
        people: body.people,
      };
      to = { start: body.start, end: body.end };
    }
    const { keep, remove } = anchorOld
      ? affectedAssignments(
          week.assignments,
          cur.locationId,
          cur.date,
          anchorOld,
          to,
        )
      : { keep: [], remove: [] };
    return apply(
      c,
      week,
      {
        op: { type: "update", id, version: body.version, set },
        keep: keep.map((a) => a.id),
        anchor: to,
        remove,
        action: set.kind === "cancelled" ? "shift_cancelled" : "shift_changed",
        snapshot: snapshot({ ...cur, ...set }),
      },
      body.removeAssignments,
      200,
    );
  });

  app.delete("/schedule/overrides/:id", async (c) => {
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
    const confirmed = c.req.query("removeAssignments") === "true";
    const cur = await repo.getOverride(id);
    if (!cur) return notFound(c);
    if (cur.date < today()) return past(c);
    const week = await repo.week(mondayOf(cur.date), today());
    // added → delete (assignments go), changed → reset to base (fitting ones re-anchored), cancelled → reset
    const anchorOld =
      cur.kind === "cancelled"
        ? null
        : { start: cur.start as string, end: cur.end as string };
    const to =
      cur.kind === "changed"
        ? { start: cur.baseStart as string, end: cur.baseEnd as string }
        : null;
    const { keep, remove } = anchorOld
      ? affectedAssignments(
          week.assignments,
          cur.locationId,
          cur.date,
          anchorOld,
          to,
        )
      : { keep: [], remove: [] };
    return apply(
      c,
      week,
      {
        op: { type: "delete", id, version },
        keep: keep.map((a) => a.id),
        anchor: to,
        remove,
        action: cur.kind === "added" ? "shift_deleted" : "shift_reset",
        snapshot: snapshot(cur),
      },
      confirmed,
      204,
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

const names = (week: ScheduleWeek, list: Assignment[]) =>
  list.map((a) => {
    const e = week.employees.find((x) => x.id === a.employeeId);
    return e ? `${e.firstName} ${e.lastName}` : "unbekannt";
  });

const snapshot = (
  o: Pick<
    ShiftOverride,
    "date" | "kind" | "baseStart" | "baseEnd" | "start" | "end" | "people"
  >,
) => ({
  date: o.date,
  kind: o.kind,
  baseStart: o.baseStart,
  baseEnd: o.baseEnd,
  start: o.start,
  end: o.end,
  people: o.people,
});

function respondOverride(
  c: Context<AppEnv>,
  result: OverrideResult,
  okStatus: 200 | 201 | 204 = 200,
) {
  const requestId = c.get("requestId");
  switch (result.kind) {
    case "ok":
      return okStatus === 204
        ? c.body(null, 204)
        : c.json(result.override as object, okStatus);
    case "conflict":
      return c.json(
        { error: "version_conflict", current: result.current, requestId },
        409,
      );
    case "already_overridden":
      return c.json({ error: "already_overridden", requestId }, 409);
    case "not_found":
      return c.json({ error: "not_found", requestId }, 404);
  }
}

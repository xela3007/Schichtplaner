import { Hono } from "hono";
import {
  StaffingUpdate,
  windowsOutsideOpeningHours,
} from "#shared/staffing.js";
import { requirePermission } from "../auth/middleware.js";
import type { LocationRepository } from "../locations/repository.js";
import type { StaffingRepository } from "../staffing/repository.js";
import type { AppEnv } from "../types.js";
import { parseJson } from "../validation.js";
import { MANAGE } from "./locations.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Staffing demand is planner knowledge: read AND write need locations.manage (ADR-010). */
export function staffingRoutes(
  locations: LocationRepository,
  staffing: StaffingRepository,
) {
  const app = new Hono<AppEnv>();
  app.use("/locations/:id/staffing", requirePermission(MANAGE));

  app.get("/locations/:id/staffing", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id) || !(await locations.get(id))) {
      return c.json({ error: "not_found", requestId: c.get("requestId") }, 404);
    }
    return c.json(await staffing.get(id), 200);
  });

  app.put("/locations/:id/staffing", async (c) => {
    const id = c.req.param("id");
    const location = UUID.test(id) ? await locations.get(id) : null;
    if (!location)
      return c.json({ error: "not_found", requestId: c.get("requestId") }, 404);

    const parsed = await parseJson(c, StaffingUpdate);
    if ("response" in parsed) return parsed.response;
    const { windows, version } = parsed.data;

    // Validated against the CURRENT opening hours — they may have changed since the form was opened.
    const outside = windowsOutsideOpeningHours(windows, location.openingHours);
    if (outside.length > 0) {
      return c.json(
        {
          error: "outside_opening_hours",
          requestId: c.get("requestId"),
          issues: outside.map((i) => ({
            field: `windows.${i}.start`,
            message: "Liegt außerhalb der Öffnungszeiten.",
          })),
        },
        400,
      );
    }

    const result = await staffing.save(id, windows, version);
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
    return c.json(result.staffing, 200);
  });

  return app;
}

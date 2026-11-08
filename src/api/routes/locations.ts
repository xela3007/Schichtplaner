import { type Context, Hono } from "hono";
import {
  LocationInput,
  LocationUpdate,
  VersionOnly,
} from "#shared/locations.js";
import { requirePermission } from "../auth/middleware.js";
import type {
  LocationRepository,
  WriteResult,
} from "../locations/repository.js";
import type { AppEnv } from "../types.js";
import { parseJson } from "../validation.js";

export const MANAGE = "locations.manage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canManage(c: Context<AppEnv>) {
  return c.get("auth").permissions.includes(MANAGE);
}

function notFound(c: Context<AppEnv>) {
  return c.json({ error: "not_found", requestId: c.get("requestId") }, 404);
}

function respond(
  c: Context<AppEnv>,
  result: WriteResult,
  okStatus: 200 | 201 = 200,
) {
  switch (result.kind) {
    case "ok":
      return c.json(result.location, okStatus);
    case "conflict":
      return c.json(
        {
          error: "version_conflict",
          current: result.current,
          requestId: c.get("requestId"),
        },
        409,
      );
    case "name_taken":
      return c.json(
        { error: "name_taken", requestId: c.get("requestId") },
        409,
      );
    case "not_found":
      return notFound(c);
  }
}

/** Mounted behind requireAuth. Writes and history need `locations.manage` (ADR-010). */
export function locationRoutes(repo: LocationRepository) {
  const app = new Hono<AppEnv>();

  app.get("/locations", async (c) => {
    const includeInactive = c.req.query("includeInactive") === "true";
    if (includeInactive && !canManage(c)) {
      return c.json({ error: "forbidden", requestId: c.get("requestId") }, 403);
    }
    return c.json({ locations: await repo.list({ includeInactive }) }, 200);
  });

  app.post("/locations", requirePermission(MANAGE), async (c) => {
    const parsed = await parseJson(c, LocationInput);
    if ("response" in parsed) return parsed.response;
    return respond(
      c,
      await repo.create(parsed.data, c.get("auth").userId),
      201,
    );
  });

  app.get("/locations/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const location = await repo.get(id);
    // Inactive locations don't exist for people who can't manage them.
    if (!location || (!location.active && !canManage(c))) return notFound(c);
    return c.json(location, 200);
  });

  app.put("/locations/:id", requirePermission(MANAGE), async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const parsed = await parseJson(c, LocationUpdate);
    if ("response" in parsed) return parsed.response;
    const { version, ...input } = parsed.data;
    return respond(
      c,
      await repo.update(id, input, version, c.get("auth").userId),
    );
  });

  for (const [action, active] of [
    ["deactivate", false],
    ["reactivate", true],
  ] as const) {
    app.post(
      `/locations/:id/${action}`,
      requirePermission(MANAGE),
      async (c) => {
        const id = c.req.param("id");
        if (!UUID.test(id)) return notFound(c);
        const parsed = await parseJson(c, VersionOnly);
        if ("response" in parsed) return parsed.response;
        return respond(
          c,
          await repo.setActive(
            id,
            active,
            parsed.data.version,
            c.get("auth").userId,
          ),
        );
      },
    );
  }

  app.get("/locations/:id/history", requirePermission(MANAGE), async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    if (!(await repo.get(id))) return notFound(c);
    return c.json({ entries: await repo.history(id) }, 200);
  });

  return app;
}

import { type Context, Hono } from "hono";
import {
  CatalogInput,
  CatalogUpdate,
  ContractTypeInput,
  ContractTypeUpdate,
} from "#shared/catalogs.js";
import { VersionOnly } from "#shared/locations.js";
import { requirePermission } from "../auth/middleware.js";
import type {
  CatalogRepository,
  CatalogResult,
  ContractTypeRepository,
} from "../catalogs/repository.js";
import type { AppEnv } from "../types.js";
import { parseJson } from "../validation.js";

export const EMPLOYEES_MANAGE = "employees.manage";
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const notFound = (c: Context<AppEnv>) =>
  c.json({ error: "not_found", requestId: c.get("requestId") }, 404);

function respond<T>(
  c: Context<AppEnv>,
  result: CatalogResult<T>,
  okStatus: 200 | 201 = 200,
) {
  const requestId = c.get("requestId");
  switch (result.kind) {
    case "ok":
      return c.json(result.entry as object, okStatus);
    case "conflict":
      return c.json(
        { error: "version_conflict", current: result.current, requestId },
        409,
      );
    case "in_use":
      return c.json(
        { error: "contract_type_in_use", current: result.current, requestId },
        409,
      );
    case "name_taken":
      return c.json({ error: "name_taken", requestId }, 409);
    case "not_found":
      return notFound(c);
  }
}

function activation<T>(
  app: Hono<AppEnv>,
  base: string,
  setActive: (
    id: string,
    active: boolean,
    version: number,
    actorId: string,
  ) => Promise<CatalogResult<T>>,
) {
  for (const [action, active] of [
    ["deactivate", false],
    ["reactivate", true],
  ] as const) {
    app.post(`${base}/:id/${action}`, async (c) => {
      const id = c.req.param("id");
      if (!UUID.test(id)) return notFound(c);
      const parsed = await parseJson(c, VersionOnly);
      if ("response" in parsed) return parsed.response;
      return respond(
        c,
        await setActive(id, active, parsed.data.version, c.get("auth").userId),
      );
    });
  }
}

/** Auswahllisten. Mounted behind requireAuth; everything needs `employees.manage` (ADR-010). */
export function catalogRoutes(deps: {
  contractTypes: ContractTypeRepository;
  qualifications: CatalogRepository;
  systemAccesses: CatalogRepository;
}) {
  const app = new Hono<AppEnv>();
  for (const base of [
    "/contract-types",
    "/qualifications",
    "/system-accesses",
  ]) {
    app.use(base, requirePermission(EMPLOYEES_MANAGE));
    app.use(`${base}/*`, requirePermission(EMPLOYEES_MANAGE));
  }

  // Contract types
  const ct = deps.contractTypes;
  app.get("/contract-types", async (c) =>
    c.json({ items: await ct.list() }, 200),
  );
  app.post("/contract-types", async (c) => {
    const parsed = await parseJson(c, ContractTypeInput);
    if ("response" in parsed) return parsed.response;
    return respond(c, await ct.create(parsed.data, c.get("auth").userId), 201);
  });
  app.put("/contract-types/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const parsed = await parseJson(c, ContractTypeUpdate);
    if ("response" in parsed) return parsed.response;
    const { version, ...input } = parsed.data;
    return respond(
      c,
      await ct.update(id, input, version, c.get("auth").userId),
    );
  });
  activation(app, "/contract-types", (...a) => ct.setActive(...a));

  // Qualifications and system accesses (name only)
  for (const [base, repo] of [
    ["/qualifications", deps.qualifications],
    ["/system-accesses", deps.systemAccesses],
  ] as const) {
    app.get(base, async (c) => c.json({ items: await repo.list() }, 200));
    app.post(base, async (c) => {
      const parsed = await parseJson(c, CatalogInput);
      if ("response" in parsed) return parsed.response;
      return respond(
        c,
        await repo.create(parsed.data.name, c.get("auth").userId),
        201,
      );
    });
    app.put(`${base}/:id`, async (c) => {
      const id = c.req.param("id");
      if (!UUID.test(id)) return notFound(c);
      const parsed = await parseJson(c, CatalogUpdate);
      if ("response" in parsed) return parsed.response;
      return respond(
        c,
        await repo.rename(
          id,
          parsed.data.name,
          parsed.data.version,
          c.get("auth").userId,
        ),
      );
    });
    activation(app, base, (...a) => repo.setActive(...a));
  }

  return app;
}

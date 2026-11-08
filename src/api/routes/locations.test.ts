import { beforeEach, describe, expect, it } from "vitest";
import { Location, LocationHistory, LocationList } from "#shared/locations.js";
import { signAccessToken } from "../auth/tokens.js";
import { makeTestApp, TEST_SECRET } from "../test-support/fakes.js";

const PLANNER = "01a1b4ea-7b22-7679-af8a-a22acdbb9001";
const MEMBER = "01a1b4ea-7b22-7679-af8a-a22acdbb9002";

async function auth(sub: string, permissions: string[]) {
  return {
    Authorization: `Bearer ${await signAccessToken({ sub, permissions }, TEST_SECRET)}`,
  };
}
const planner = () => auth(PLANNER, ["locations.manage"]);
const member = () => auth(MEMBER, []);
const json = async (
  headers: Record<string, string>,
  method: string,
  body: unknown,
) => ({
  method,
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const G21 = {
  name: "Gebäude 21",
  kind: "customer_area",
  openingHours: ["mon", "tue", "wed", "thu", "fri"].map((weekday) => ({
    weekday,
    start: "07:30",
    end: "19:00",
  })),
};

let ctx: ReturnType<typeof makeTestApp>;
beforeEach(() => {
  ctx = makeTestApp();
});

async function create(body: unknown = G21) {
  const res = await ctx.app.request(
    "/locations",
    await json(await planner(), "POST", body),
  );
  return {
    res,
    body:
      res.status === 201 ? Location.parse(await res.json()) : await res.json(),
  };
}

describe("permissions", () => {
  it("401 without login on every endpoint", async () => {
    for (const [method, path] of [
      ["GET", "/locations"],
      ["POST", "/locations"],
      ["GET", `/locations/${PLANNER}`],
      ["PUT", `/locations/${PLANNER}`],
      ["POST", `/locations/${PLANNER}/deactivate`],
      ["GET", `/locations/${PLANNER}/history`],
    ]) {
      const res = await ctx.app.request(path as string, {
        method: method as string,
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("members can read but every write and the history is 403", async () => {
    const { body } = await create();
    const id = (body as Location).id;
    expect(
      (await ctx.app.request("/locations", { headers: await member() })).status,
    ).toBe(200);
    expect(
      (await ctx.app.request(`/locations/${id}`, { headers: await member() }))
        .status,
    ).toBe(200);
    expect(
      (
        await ctx.app.request(
          "/locations",
          await json(await member(), "POST", G21),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await ctx.app.request(
          `/locations/${id}`,
          await json(await member(), "PUT", { ...G21, version: 1 }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await ctx.app.request(
          `/locations/${id}/deactivate`,
          await json(await member(), "POST", { version: 1 }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await ctx.app.request(`/locations/${id}/history`, {
          headers: await member(),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await ctx.app.request("/locations?includeInactive=true", {
          headers: await member(),
        })
      ).status,
    ).toBe(403);
  });
});

describe("create", () => {
  it("201 with version 1; system starts empty", async () => {
    const empty = LocationList.parse(
      await (
        await ctx.app.request("/locations", { headers: await member() })
      ).json(),
    );
    expect(empty.locations).toEqual([]);
    const { res, body } = await create();
    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      name: "Gebäude 21",
      kind: "customer_area",
      active: true,
      version: 1,
    });
  });

  it("rejects duplicate names case- and whitespace-insensitively with 409 name_taken", async () => {
    await create();
    const { res, body } = await create({ ...G21, name: "  gebäude 21 " });
    expect(res.status).toBe(409);
    expect(body).toMatchObject({ error: "name_taken" });
  });

  it("rejects overlapping ranges with 400 and a field path", async () => {
    const { res, body } = await create({
      ...G21,
      openingHours: [
        { weekday: "mon", start: "08:00", end: "12:00" },
        { weekday: "mon", start: "11:00", end: "15:00" },
      ],
    });
    expect(res.status).toBe(400);
    expect(body).toMatchObject({ error: "validation_failed" });
    expect(JSON.stringify(body)).toContain("openingHours.1.start");
  });

  it("allows a location without opening hours (closed)", async () => {
    const { res } = await create({ ...G21, openingHours: [] });
    expect(res.status).toBe(201);
  });
});

describe("update with version check", () => {
  it("200 and version+1", async () => {
    const { body } = await create();
    const id = (body as Location).id;
    const res = await ctx.app.request(
      `/locations/${id}`,
      await json(await planner(), "PUT", {
        ...G21,
        name: "Geb. 21",
        version: 1,
      }),
    );
    expect(res.status).toBe(200);
    expect(Location.parse(await res.json())).toMatchObject({
      name: "Geb. 21",
      version: 2,
    });
  });

  it("stale version → 409 version_conflict with the current state, nothing written", async () => {
    const { body } = await create();
    const id = (body as Location).id;
    await ctx.app.request(
      `/locations/${id}`,
      await json(await planner(), "PUT", {
        ...G21,
        name: "Erste Änderung",
        version: 1,
      }),
    );
    const auditBefore = ctx.locations.audit.length;
    const res = await ctx.app.request(
      `/locations/${id}`,
      await json(await planner(), "PUT", {
        ...G21,
        name: "Zweite",
        version: 1,
      }),
    );
    expect(res.status).toBe(409);
    const conflict = (await res.json()) as { error: string; current: unknown };
    expect(conflict.error).toBe("version_conflict");
    expect(Location.parse(conflict.current)).toMatchObject({
      name: "Erste Änderung",
      version: 2,
    });
    expect(ctx.locations.audit.length).toBe(auditBefore);
  });

  it("unknown or malformed id → 404", async () => {
    const put = await json(await planner(), "PUT", { ...G21, version: 1 });
    expect((await ctx.app.request(`/locations/${MEMBER}`, put)).status).toBe(
      404,
    );
    expect((await ctx.app.request("/locations/not-a-uuid", put)).status).toBe(
      404,
    );
  });
});

describe("deactivate / reactivate", () => {
  it("hides inactive locations from members (list and by id), planner sees them", async () => {
    const { body } = await create();
    const id = (body as Location).id;
    const res = await ctx.app.request(
      `/locations/${id}/deactivate`,
      await json(await planner(), "POST", { version: 1 }),
    );
    expect(Location.parse(await res.json())).toMatchObject({
      active: false,
      version: 2,
    });

    const memberList = LocationList.parse(
      await (
        await ctx.app.request("/locations", { headers: await member() })
      ).json(),
    );
    expect(memberList.locations).toEqual([]);
    expect(
      (await ctx.app.request(`/locations/${id}`, { headers: await member() }))
        .status,
    ).toBe(404);

    const plannerList = LocationList.parse(
      await (
        await ctx.app.request("/locations?includeInactive=true", {
          headers: await planner(),
        })
      ).json(),
    );
    expect(plannerList.locations).toHaveLength(1);
    expect(
      (await ctx.app.request(`/locations/${id}`, { headers: await planner() }))
        .status,
    ).toBe(200);

    const back = await ctx.app.request(
      `/locations/${id}/reactivate`,
      await json(await planner(), "POST", { version: 2 }),
    );
    expect(Location.parse(await back.json())).toMatchObject({
      active: true,
      version: 3,
    });
  });
});

describe("history", () => {
  it("lists all four actions with actor, newest first", async () => {
    const { body } = await create();
    const id = (body as Location).id;
    const p = await planner();
    await ctx.app.request(
      `/locations/${id}`,
      await json(p, "PUT", { ...G21, kind: "reception", version: 1 }),
    );
    await ctx.app.request(
      `/locations/${id}/deactivate`,
      await json(p, "POST", { version: 2 }),
    );
    await ctx.app.request(
      `/locations/${id}/reactivate`,
      await json(p, "POST", { version: 3 }),
    );
    const res = await ctx.app.request(`/locations/${id}/history`, {
      headers: p,
    });
    const { entries } = LocationHistory.parse(await res.json());
    expect(entries.map((e) => e.action)).toEqual([
      "reactivated",
      "deactivated",
      "updated",
      "created",
    ]);
    expect(entries[2]?.changes).toEqual({
      kind: { from: "customer_area", to: "reception" },
    });
    expect(entries.every((e) => e.actorEmail?.startsWith(PLANNER))).toBe(true);
  });
});

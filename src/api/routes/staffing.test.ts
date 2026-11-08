import { beforeEach, describe, expect, it } from "vitest";
import { Location } from "#shared/locations.js";
import { Staffing } from "#shared/staffing.js";
import { signAccessToken } from "../auth/tokens.js";
import { makeTestApp, TEST_SECRET } from "../test-support/fakes.js";

const PLANNER = "01a1b4ea-7b22-7679-af8a-a22acdbb9001";
const MEMBER = "01a1b4ea-7b22-7679-af8a-a22acdbb9002";
const UNKNOWN = "01a1b4ea-7b22-7679-af8a-a22acdbb9fff";

const auth = async (sub: string, permissions: string[]) => ({
  Authorization: `Bearer ${await signAccessToken({ sub, permissions }, TEST_SECRET)}`,
});
const planner = () => auth(PLANNER, ["locations.manage"]);
const member = () => auth(MEMBER, []);

const G21 = {
  name: "Gebäude 21",
  kind: "customer_area",
  openingHours: ["mon", "tue", "wed", "thu", "fri"].map((weekday) => ({
    weekday,
    start: "07:30",
    end: "19:00",
  })),
};
const MONDAY = [
  { weekday: "mon", start: "07:30", end: "19:00", people: 2 },
  { weekday: "mon", start: "08:00", end: "10:00", people: 2 },
];

let ctx: ReturnType<typeof makeTestApp>;
let id: string;
beforeEach(async () => {
  ctx = makeTestApp();
  const res = await ctx.app.request("/locations", {
    method: "POST",
    headers: { ...(await planner()), "Content-Type": "application/json" },
    body: JSON.stringify(G21),
  });
  id = Location.parse(await res.json()).id;
});

const get = async (headers: Record<string, string>, loc = id) =>
  ctx.app.request(`/locations/${loc}/staffing`, { headers });
const put = async (body: unknown, headers?: Record<string, string>, loc = id) =>
  ctx.app.request(`/locations/${loc}/staffing`, {
    method: "PUT",
    headers: {
      ...(headers ?? (await planner())),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

describe("permissions", () => {
  it("401 without login", async () => {
    expect((await ctx.app.request(`/locations/${id}/staffing`)).status).toBe(
      401,
    );
    expect(
      (await ctx.app.request(`/locations/${id}/staffing`, { method: "PUT" }))
        .status,
    ).toBe(401);
  });

  it("403 for members on read and write", async () => {
    expect((await get(await member())).status).toBe(403);
    expect(
      (await put({ windows: [], version: 0 }, await member())).status,
    ).toBe(403);
  });
});

describe("read and save", () => {
  it("returns an empty v0 default before the first save", async () => {
    const res = await get(await planner());
    expect(res.status).toBe(200);
    expect(Staffing.parse(await res.json())).toEqual({
      windows: [],
      version: 0,
      updatedAt: null,
    });
  });

  it("saves v0 → v1 → v2 and reads it back", async () => {
    const first = await put({ windows: MONDAY, version: 0 });
    expect(first.status).toBe(200);
    expect(Staffing.parse(await first.json()).version).toBe(1);
    const second = await put({ windows: MONDAY.slice(0, 1), version: 1 });
    expect(Staffing.parse(await second.json()).version).toBe(2);
    const read = Staffing.parse(await (await get(await planner())).json());
    expect(read.windows).toEqual(MONDAY.slice(0, 1));
    expect(read.updatedAt).not.toBeNull();
  });

  it("409 with the current state on a stale version", async () => {
    await put({ windows: MONDAY, version: 0 });
    const stale = await put({ windows: [], version: 0 });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { error: string; current: unknown };
    expect(body.error).toBe("version_conflict");
    expect(Staffing.parse(body.current).windows).toEqual(MONDAY);
  });

  it("concurrent first saves: exactly one wins", async () => {
    const results = await Promise.all([
      put({ windows: MONDAY, version: 0 }),
      put({ windows: MONDAY.slice(1), version: 0 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("works for a deactivated location", async () => {
    await ctx.app.request(`/locations/${id}/deactivate`, {
      method: "POST",
      headers: { ...(await planner()), "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1 }),
    });
    expect((await put({ windows: MONDAY, version: 0 })).status).toBe(200);
    expect((await get(await planner())).status).toBe(200);
  });
});

describe("validation", () => {
  it("400 outside_opening_hours with the window's path, nothing saved", async () => {
    const res = await put({
      windows: [
        ...MONDAY,
        { weekday: "mon", start: "18:00", end: "20:00", people: 1 },
      ],
      version: 0,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      issues: { field: string }[];
    };
    expect(body.error).toBe("outside_opening_hours");
    expect(body.issues.map((i: { field: string }) => i.field)).toEqual([
      "windows.2.start",
    ]);
    expect(
      Staffing.parse(await (await get(await planner())).json()).version,
    ).toBe(0);
  });

  it("400 for a closed day and for invalid people", async () => {
    expect(
      (
        await put({
          windows: [
            { weekday: "sat", start: "09:00", end: "12:00", people: 1 },
          ],
          version: 0,
        })
      ).status,
    ).toBe(400);
    const bad = await put({
      windows: [{ ...MONDAY[0], people: 0 }],
      version: 0,
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe(
      "validation_failed",
    );
  });

  it("404 for unknown or malformed location ids", async () => {
    expect((await get(await planner(), UNKNOWN)).status).toBe(404);
    expect((await get(await planner(), "nope")).status).toBe(404);
    expect(
      (await put({ windows: [], version: 0 }, undefined, UNKNOWN)).status,
    ).toBe(404);
  });
});

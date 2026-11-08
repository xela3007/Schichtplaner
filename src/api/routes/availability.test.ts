import { beforeEach, describe, expect, it } from "vitest";
import { makeTestApp } from "../test-support/fakes.js";
import {
  bearer,
  client,
  memberAuth,
  PLANNER_ID,
} from "../test-support/http.js";

let ctx: ReturnType<typeof makeTestApp>;
let call: ReturnType<typeof client>;
let anna: string;
let ben: string;

beforeEach(async () => {
  ctx = makeTestApp();
  call = client(ctx.app);
  const ct = (
    await call("POST", "/contract-types", { name: "30", weeklyMinutes: 1800 })
  ).body.id;
  const mk = async (firstName: string, lastName: string) =>
    (
      await call("POST", "/employees", {
        firstName,
        lastName,
        mobile: "0151 23456789",
        contractTypeId: ct,
      })
    ).body.id;
  anna = await mk("Anna", "Müller");
  ben = await mk("Ben", "Alt");
});

const vacation = {
  kind: "vacation",
  startDate: "2026-10-28",
  endDate: "2026-11-03",
};

describe("permissions", () => {
  it("401 without login, 403 without availability.manage", async () => {
    expect(
      (await ctx.app.request("/availability/week?start=2026-11-02")).status,
    ).toBe(401);
    const noAvail = await bearer(PLANNER_ID, ["employees.manage"]);
    expect(
      (
        await call(
          "GET",
          "/availability/week?start=2026-11-02",
          undefined,
          noAvail,
        )
      ).status,
    ).toBe(403);
    expect(
      (await call("POST", `/employees/${anna}/absences`, vacation, noAvail))
        .status,
    ).toBe(403);
    expect(
      (
        await call(
          "GET",
          `/employees/${anna}/availability`,
          undefined,
          await memberAuth(),
        )
      ).status,
    ).toBe(403);
  });

  it("availability-only users read employees and lists but cannot change them", async () => {
    const only = await bearer(PLANNER_ID, ["availability.manage"]);
    expect((await call("GET", "/employees", undefined, only)).status).toBe(200);
    expect(
      (await call("GET", `/employees/${anna}`, undefined, only)).status,
    ).toBe(200);
    expect(
      (await call("GET", `/employees/${anna}/history`, undefined, only)).status,
    ).toBe(200);
    expect((await call("GET", "/qualifications", undefined, only)).status).toBe(
      200,
    );
    expect((await call("GET", "/contract-types", undefined, only)).status).toBe(
      200,
    );
    expect(
      (await call("POST", "/qualifications", { name: "x" }, only)).status,
    ).toBe(403);
    expect(
      (
        await call(
          "POST",
          `/employees/${anna}/deactivate`,
          { version: 1 },
          only,
        )
      ).status,
    ).toBe(403);
    expect(
      (await call("POST", `/employees/${anna}/absences`, vacation, only))
        .status,
    ).toBe(201);
  });
});

describe("absences", () => {
  it("create, update, version-checked delete; audit on the employee", async () => {
    const created = await call("POST", `/employees/${anna}/absences`, {
      ...vacation,
      note: "Mallorca",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      employeeId: anna,
      startTime: null,
      version: 1,
    });
    const id = created.body.id;
    const updated = await call("PUT", `/absences/${id}`, {
      ...vacation,
      endDate: "2026-11-04",
      version: 1,
    });
    expect(updated.body).toMatchObject({
      endDate: "2026-11-04",
      version: 2,
      note: null,
    });
    expect(
      (await call("PUT", `/absences/${id}`, { ...vacation, version: 1 }))
        .status,
    ).toBe(409);
    const stale = await call("DELETE", `/absences/${id}?version=1`);
    expect(stale.status).toBe(409);
    expect(stale.body.current.version).toBe(2);
    expect((await call("DELETE", `/absences/${id}`)).status).toBe(400);
    expect((await call("DELETE", `/absences/${id}?version=2`)).status).toBe(
      204,
    );
    expect(
      (await call("GET", `/employees/${anna}/availability`)).body.absences,
    ).toEqual([]);
    const { entries } = (await call("GET", `/employees/${anna}/history`)).body;
    expect(
      entries.slice(0, 3).map((e: { action: string }) => e.action),
    ).toEqual(["absence_deleted", "absence_changed", "absence_added"]);
    expect(entries[0].changes.entry.from).toMatchObject({
      kind: "vacation",
      endDate: "2026-11-04",
    });
  });

  it("validates times and ranges; 404 for unknown employee or entry", async () => {
    const multi = await call("POST", `/employees/${anna}/absences`, {
      ...vacation,
      startTime: "08:00",
      endTime: "12:00",
    });
    expect(multi.body.issues[0].field).toBe("startTime");
    const single = await call("POST", `/employees/${anna}/absences`, {
      kind: "appointment",
      startDate: "2026-11-10",
      endDate: "2026-11-10",
      startTime: "14:00",
      endTime: "16:00",
    });
    expect(single.status).toBe(201);
    expect(
      (
        await call(
          "POST",
          "/employees/01a1b4ea-7b22-7679-af8a-a22acdbb9fff/absences",
          vacation,
        )
      ).status,
    ).toBe(404);
    expect(
      (await call("PUT", "/absences/nope", { ...vacation, version: 1 })).status,
    ).toBe(404);
  });
});

describe("rules", () => {
  it("create, update, delete with audit", async () => {
    const r = await call("POST", `/employees/${anna}/availability-rules`, {
      weekdays: ["fri", "mon", "tue", "wed", "thu"],
      startTime: "16:00",
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      startTime: "16:00",
      endTime: null,
    });
    const u = await call("PUT", `/availability-rules/${r.body.id}`, {
      weekdays: ["tue"],
      version: 1,
    });
    expect(u.body).toMatchObject({
      weekdays: ["tue"],
      startTime: null,
      version: 2,
    });
    expect(
      (
        await call("POST", `/employees/${anna}/availability-rules`, {
          weekdays: [],
        })
      ).status,
    ).toBe(400);
    expect(
      (await call("DELETE", `/availability-rules/${r.body.id}?version=2`))
        .status,
    ).toBe(204);
    const actions = (
      await call("GET", `/employees/${anna}/history`)
    ).body.entries.map((e: { action: string }) => e.action);
    expect(actions.slice(0, 3)).toEqual([
      "rule_deleted",
      "rule_changed",
      "rule_added",
    ]);
  });
});

describe("week view", () => {
  it("normalises to Monday, includes overlapping absences and rules, excludes inactive employees", async () => {
    await call("POST", `/employees/${anna}/absences`, vacation);
    await call("POST", `/employees/${anna}/absences`, {
      kind: "wish_off",
      startDate: "2026-11-20",
      endDate: "2026-11-20",
    });
    await call("POST", `/employees/${ben}/availability-rules`, {
      weekdays: ["tue"],
    });
    const week = await call("GET", "/availability/week?start=2026-11-04");
    expect(week.body.start).toBe("2026-11-02");
    expect(
      week.body.employees.map((e: { lastName: string }) => e.lastName),
    ).toEqual(["Alt", "Müller"]);
    expect(week.body.absences).toHaveLength(1);
    expect(week.body.rules).toHaveLength(1);
    await call("POST", `/employees/${ben}/deactivate`, { version: 1 });
    const after = await call("GET", "/availability/week?start=2026-11-02");
    expect(after.body.employees).toHaveLength(1);
    expect(after.body.rules).toHaveLength(0);
    expect(
      (await call("GET", "/availability/week?start=2026-02-31")).status,
    ).toBe(400);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { makeTestApp } from "../test-support/fakes.js";
import { bearer, client, PLANNER_ID } from "../test-support/http.js";

const TODAY = "2026-11-10"; // Tuesday
const MON = "2026-11-16";
const TUE = "2026-11-17";

let ctx: ReturnType<typeof makeTestApp>;
let call: ReturnType<typeof client>;
let g21: string;
let g5: string;
let anna: string;
let ben: string;

beforeEach(async () => {
  ctx = makeTestApp({ today: () => TODAY });
  call = client(ctx.app);
  const hours = ["mon", "tue", "wed", "thu", "fri"].map((weekday) => ({
    weekday,
    start: "07:30",
    end: "19:00",
  }));
  g21 = (
    await call("POST", "/locations", {
      name: "Gebäude 21",
      kind: "customer_area",
      openingHours: hours,
    })
  ).body.id;
  g5 = (
    await call("POST", "/locations", {
      name: "Gebäude 5",
      kind: "reception",
      openingHours: hours,
    })
  ).body.id;
  await call("PUT", `/locations/${g21}/staffing`, {
    version: 0,
    windows: [
      { weekday: "mon", start: "07:30", end: "19:00", people: 2 },
      { weekday: "mon", start: "08:00", end: "10:00", people: 2 },
    ],
  });
  const ct = (
    await call("POST", "/contract-types", { name: "30", weeklyMinutes: 1800 })
  ).body.id;
  const mk = async (firstName: string, lastName: string, extra: object = {}) =>
    (
      await call("POST", "/employees", {
        firstName,
        lastName,
        mobile: "0151 23456789",
        contractTypeId: ct,
        ...extra,
      })
    ).body.id;
  anna = await mk("Anna", "Müller", {
    locations: [{ locationId: g21, trained: true, preference: "preferred" }],
  });
  ben = await mk("Ben", "Alt");
});

const assign = (o: object = {}) =>
  call("POST", "/schedule/assignments", {
    locationId: g21,
    employeeId: anna,
    date: MON,
    start: "07:30",
    end: "19:00",
    shiftStart: "07:30",
    shiftEnd: "19:00",
    ...o,
  });

describe("permissions", () => {
  it("401 without login, 403 without schedule.manage", async () => {
    expect((await ctx.app.request(`/schedule/week?start=${MON}`)).status).toBe(
      401,
    );
    const other = await bearer(PLANNER_ID, [
      "employees.manage",
      "locations.manage",
      "availability.manage",
    ]);
    expect(
      (await call("GET", `/schedule/week?start=${MON}`, undefined, other))
        .status,
    ).toBe(403);
    expect(
      (await call("POST", "/schedule/assignments", {}, other)).status,
    ).toBe(403);
  });
});

describe("week payload", () => {
  it("normalises to Monday, contains active data and no contact details", async () => {
    const w = await call("GET", `/schedule/week?start=2026-11-19`);
    expect(w.body.start).toBe(MON);
    expect(w.body.today).toBe(TODAY);
    expect(
      w.body.locations.map((l: { name: string }) => l.name).sort(),
    ).toEqual(["Gebäude 21", "Gebäude 5"]);
    expect(
      w.body.locations.find((l: { id: string }) => l.id === g21)
        .staffingWindows,
    ).toHaveLength(2);
    expect(w.body.employees[0]).not.toHaveProperty("mobile");
    expect(JSON.stringify(w.body)).not.toContain("+49");
    expect((await call("GET", "/schedule/week?start=2026-02-31")).status).toBe(
      400,
    );
  });
});

describe("assign and remove", () => {
  it("assigns, rejects overlaps anywhere, allows touching times", async () => {
    const a = await assign();
    expect(a.status).toBe(201);
    const clash = await assign({
      locationId: g5,
      start: "18:00",
      end: "19:00",
      shiftStart: "18:00",
      shiftEnd: "19:00",
    });
    expect(clash.status).toBe(400);
    expect(clash.body.reasons[0]).toMatchObject({
      code: "overlap",
      message: "zeitgleich in Gebäude 21 07:30–19:00",
    });
    const other = await assign({
      employeeId: ben,
      start: "07:30",
      end: "12:00",
    });
    expect(other.status).toBe(201);
    const touching = await assign({
      employeeId: ben,
      start: "12:00",
      end: "15:00",
    });
    expect(touching.status).toBe(201);
  });

  it("blocks hard absences, rules, blocked locations and past days — warnings never block", async () => {
    await call("POST", `/employees/${anna}/absences`, {
      kind: "vacation",
      startDate: MON,
      endDate: MON,
    });
    expect(
      (await assign()).body.reasons.map((r: { code: string }) => r.code),
    ).toEqual(["absence"]);
    await call("POST", `/employees/${anna}/availability-rules`, {
      weekdays: ["tue"],
      startTime: "16:00",
    });
    const rule = await assign({ date: TUE, start: "08:00", end: "17:00" });
    expect(rule.body.reasons[0].message).toBe("nicht verfügbar Di ab 16:00");
    expect(
      (await assign({ date: TUE, start: "08:00", end: "16:00" })).status,
    ).toBe(201);
    const past = await assign({ date: "2026-11-09" });
    expect(past.body.reasons.map((r: { code: string }) => r.code)).toContain(
      "past",
    );
    // Ben: not trained at Gebäude 21 → only a warning
    expect((await assign({ employeeId: ben })).status).toBe(201);
  });

  it("rejects times outside opening hours and unknown/inactive people", async () => {
    expect((await assign({ start: "07:00" })).body.issues[0].message).toBe(
      "Liegt außerhalb der Öffnungszeiten.",
    );
    await call("POST", `/employees/${ben}/deactivate`, { version: 1 });
    expect((await assign({ employeeId: ben })).status).toBe(404);
  });

  it("version-checked removal, not for past days; history per location and week", async () => {
    const a = (await assign()).body;
    expect(
      (await call("DELETE", `/schedule/assignments/${a.id}?version=2`)).status,
    ).toBe(409);
    expect((await call("DELETE", `/schedule/assignments/${a.id}`)).status).toBe(
      400,
    );
    expect(
      (await call("DELETE", `/schedule/assignments/${a.id}?version=1`)).status,
    ).toBe(204);
    const h = await call(
      "GET",
      `/schedule/history?locationId=${g21}&start=${TUE}`,
    );
    expect(h.body.entries.map((e: { action: string }) => e.action)).toEqual([
      "unassigned",
      "assigned",
    ]);
    const other = await call(
      "GET",
      `/schedule/history?locationId=${g21}&start=2026-11-23`,
    );
    expect(other.body.entries).toEqual([]);
  });
});

describe("deactivation with assignments", () => {
  it("asks first, then removes future assignments and deactivates; today stays", async () => {
    const today = await assign({
      date: TODAY,
      start: "08:00",
      end: "12:00",
      shiftStart: "07:30",
      shiftEnd: "19:00",
    });
    expect(today.status).toBe(201);
    await assign();
    const ask = await call("POST", `/employees/${anna}/deactivate`, {
      version: 1,
    });
    expect(ask.status).toBe(409);
    expect(ask.body).toMatchObject({ error: "has_assignments", count: 1 });
    const noRight = await bearer(PLANNER_ID, ["employees.manage"]);
    expect(
      (
        await call(
          "POST",
          `/employees/${anna}/deactivate`,
          { version: 1, removeAssignments: true },
          noRight,
        )
      ).status,
    ).toBe(403);
    const done = await call("POST", `/employees/${anna}/deactivate`, {
      version: 1,
      removeAssignments: true,
    });
    expect(done.status).toBe(200);
    expect(done.body.active).toBe(false);
    const left = [...ctx.schedule.rows.values()].map((a) => a.date);
    expect(left).toEqual([TODAY]);
    const h = await call(
      "GET",
      `/schedule/history?locationId=${g21}&start=${MON}`,
    );
    expect(h.body.entries[0].changes.reason.to).toBe("employee_deactivated");
  });

  it("locations ask the same way; without assignments deactivation works as before", async () => {
    await assign();
    expect(
      (await call("POST", `/locations/${g21}/deactivate`, { version: 1 })).body
        .error,
    ).toBe("has_assignments");
    expect(
      (
        await call("POST", `/locations/${g21}/deactivate`, {
          version: 1,
          removeAssignments: true,
        })
      ).body.active,
    ).toBe(false);
    expect(
      (await call("POST", `/locations/${g5}/deactivate`, { version: 1 })).body
        .active,
    ).toBe(false);
  });
});

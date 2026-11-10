import { beforeEach, describe, expect, it } from "vitest";
import { makeTestApp } from "../test-support/fakes.js";
import { bearer, client, PLANNER_ID } from "../test-support/http.js";

// Teil 3 (story 4456a836): copy a template week into up to 4 target weeks.
const TODAY = "2026-11-24"; // Tuesday of the first target week
const SRC = "2026-11-16";
const W1 = "2026-11-23";
const W2 = "2026-11-30";

let ctx: ReturnType<typeof makeTestApp>;
let call: ReturnType<typeof client>;
let g21: string;
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
  await call("PUT", `/locations/${g21}/staffing`, {
    version: 0,
    windows: ["mon", "tue", "wed"].map((weekday) => ({
      weekday,
      start: "07:30",
      end: "19:00",
      people: 2,
    })),
  });
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
        locations: [{ locationId: g21, trained: true, preference: "neutral" }],
      })
    ).body.id;
  anna = await mk("Anna", "Müller");
  ben = await mk("Ben", "Brandt");
  // source week (in the past — assignments seeded directly, like history)
  for (const [employeeId, date] of [
    [anna, "2026-11-16"],
    [anna, "2026-11-17"],
    [ben, "2026-11-18"],
  ] as const) {
    const id = `01a1bb3f-0000-7000-8000-${String(ctx.schedule.rows.size + 1).padStart(12, "0")}`;
    ctx.schedule.rows.set(id, {
      id,
      locationId: g21,
      employeeId,
      date,
      start: "07:30",
      end: "13:00",
      shiftStart: "07:30",
      shiftEnd: "19:00",
      version: 1,
      updatedAt: new Date().toISOString(),
    });
  }
});

const copy = (o: object = {}) =>
  call("POST", "/schedule/copies", {
    sourceStart: SRC,
    targetStarts: [W1, W2],
    locationIds: [g21],
    ...o,
  });

describe("POST /schedule/copies", () => {
  it("validates input", async () => {
    for (const body of [
      { targetStarts: ["2026-11-24"] }, // not a Monday
      { targetStarts: [W1, W2, "2026-12-07", "2026-12-14", "2026-12-21"] },
      { targetStarts: [W1, W1] },
      { targetStarts: [SRC] },
      { targetStarts: ["2026-11-09"] }, // ended before today
      { locationIds: ["01a1bb3f-0000-7000-8000-000000000999"] },
    ]) {
      const r = await copy(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(ctx.schedule.copies.size).toBe(0);
  });

  it("copies from today on, lists skips and audits week_copied", async () => {
    await call("POST", `/employees/${ben}/absences`, {
      kind: "vacation",
      startDate: "2026-12-02",
      endDate: "2026-12-02",
    });
    const r = await copy();
    expect(r.status).toBe(201);
    // W1: Mon 23 is before today → ignored; Tue 24 + Wed 25 copied. W2: Mon, Tue copied, Wed Ben absent.
    expect(r.body.copied).toBe(4);
    expect(r.body.alreadyPresent).toBe(0);
    expect(r.body.skipped).toEqual([
      expect.objectContaining({
        employeeName: "Brandt, Ben",
        locationName: "Gebäude 21",
        date: "2026-12-02",
        start: "07:30",
        end: "13:00",
        reason: "absence",
        message: "abwesend: Urlaub",
      }),
    ]);
    expect(r.body.copy).toMatchObject({
      sourceStart: SRC,
      targetStarts: [W1, W2],
      locationIds: [g21],
      copied: 4,
      remaining: 4,
      undoneAt: null,
      version: 1,
    });
    const dates = [...ctx.schedule.rows.values()]
      .filter((a) => a.date >= W1)
      .map((a) => a.date)
      .sort();
    expect(dates).toEqual([
      "2026-11-24",
      "2026-11-25",
      "2026-11-30",
      "2026-12-01",
    ]);
    const copied = ctx.schedule.audit.filter(
      (e) => (e.changes.reason as { to?: string })?.to === "week_copied",
    );
    expect(copied).toHaveLength(4);
    expect(copied.every((e) => e.action === "assigned")).toBe(true);
  });

  it("a second copy finds everything already present and writes nothing", async () => {
    await copy();
    const r = await copy();
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ copy: null, copied: 0, alreadyPresent: 5 });
    expect(ctx.schedule.copies.size).toBe(1);
  });

  it("nothing to copy → copy null", async () => {
    const r = await copy({ sourceStart: "2026-11-02" });
    expect(r.body).toMatchObject({
      copy: null,
      copied: 0,
      alreadyPresent: 0,
      skipped: [],
    });
  });

  it("403 without schedule.manage", async () => {
    const other = await bearer(PLANNER_ID, ["employees.manage"]);
    expect((await call("POST", "/schedule/copies", {}, other)).status).toBe(
      403,
    );
    expect(
      (await call("GET", "/schedule/copies", undefined, other)).status,
    ).toBe(403);
  });
});

describe("list and undo", () => {
  it("lists copies with remaining; undo removes only copied rows from today on", async () => {
    const created = (await copy()).body.copy;
    // a manual assignment in the target week stays
    const manual = await call("POST", "/schedule/assignments", {
      locationId: g21,
      employeeId: ben,
      date: "2026-11-24",
      start: "14:00",
      end: "19:00",
      shiftStart: "07:30",
      shiftEnd: "19:00",
    });
    expect(manual.status).toBe(201);
    const list = await call("GET", "/schedule/copies");
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: created.id,
      remaining: 5,
      actorEmail: expect.any(String),
    });

    const undo = await call("POST", `/schedule/copies/${created.id}/undo`, {
      version: 1,
    });
    expect(undo.status).toBe(200);
    expect(undo.body).toMatchObject({
      removed: 5,
      copy: { remaining: 0, version: 2 },
    });
    expect(undo.body.copy.undoneAt).not.toBeNull();
    expect(ctx.schedule.rows.has(manual.body.id)).toBe(true);
    // source week untouched
    expect(
      [...ctx.schedule.rows.values()].filter((a) => a.date < W1),
    ).toHaveLength(3);
    const undone = ctx.schedule.audit.filter(
      (e) => (e.changes.reason as { to?: string })?.to === "copy_undone",
    );
    expect(undone).toHaveLength(5);
    expect(undone.every((e) => e.action === "unassigned")).toBe(true);
  });

  it("keeps past days of a copy when undoing", async () => {
    const created = (await copy()).body.copy;
    // the copy filled Tue 24 (= today); undo one day later keeps the 24th
    const r = await ctx.schedule.undoCopy(
      created.id,
      1,
      "2026-11-25",
      PLANNER_ID,
    );
    expect(r).toMatchObject({ kind: "ok", removed: 4 });
    expect(
      [...ctx.schedule.rows.values()].some((a) => a.date === "2026-11-24"),
    ).toBe(true);
  });

  it("version conflict and unknown id", async () => {
    const created = (await copy()).body.copy;
    expect(
      (
        await call("POST", `/schedule/copies/${created.id}/undo`, {
          version: 1,
        })
      ).status,
    ).toBe(200);
    const again = await call("POST", `/schedule/copies/${created.id}/undo`, {
      version: 1,
    });
    expect(again.status).toBe(409);
    expect(again.body.current.version).toBe(2);
    expect(
      (
        await call(
          "POST",
          "/schedule/copies/01a1bb3f-0000-7000-8000-000000000999/undo",
          { version: 1 },
        )
      ).status,
    ).toBe(404);
  });
});

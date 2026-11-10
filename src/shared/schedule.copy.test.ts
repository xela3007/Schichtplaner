import { describe, expect, it } from "vitest";
import type { Absence } from "./availability.js";
import {
  type Assignment,
  CopyInput,
  planCopy,
  type ScheduleEmployee,
  type ScheduleWeek,
  type ShiftOverride,
} from "./schedule.js";

const T = "2026-11-08T08:00:00.000Z";
const L1 = "01a1bb3f-0000-7000-8000-000000000031";
const L2 = "01a1bb3f-0000-7000-8000-000000000032";
const A = "01a1bb3f-0000-7000-8000-000000000041";
const B = "01a1bb3f-0000-7000-8000-000000000042";
const SRC = "2026-11-16";
const W1 = "2026-11-23";
const W2 = "2026-11-30";
const W3 = "2026-12-07";
const W4 = "2026-12-14";
const TODAY = "2026-11-17";

const hours = ["mon", "tue", "wed", "thu", "fri"].map((weekday) => ({
  weekday: weekday as "mon",
  start: "07:30",
  end: "19:00",
}));
const emp = (o: Partial<ScheduleEmployee> = {}): ScheduleEmployee => ({
  id: A,
  firstName: "Anna",
  lastName: "Müller",
  active: true,
  isFloater: false,
  weeklyTarget: 1200,
  allowedShiftMinutes: [],
  maxDailyMinutes: null,
  locations: [{ locationId: L1, trained: true, preference: "neutral" }],
  ...o,
});
let n = 0;
const asg = (o: Partial<Assignment>): Assignment => ({
  id: `01a1bb3f-0000-7000-8000-0000000009${String(++n).padStart(2, "0")}`,
  locationId: L1,
  employeeId: A,
  date: SRC,
  start: "07:30",
  end: "12:00",
  shiftStart: "07:30",
  shiftEnd: "12:00",
  version: 1,
  updatedAt: T,
  ...o,
});
const week = (start: string, o: Partial<ScheduleWeek> = {}): ScheduleWeek => ({
  start,
  today: TODAY,
  locations: [
    {
      id: L1,
      name: "Gebäude 21",
      openingHours: hours,
      staffingWindows: ["mon", "tue", "wed"].flatMap((weekday) => [
        { weekday, start: "07:30", end: "12:00", people: 1 },
        { weekday, start: "12:00", end: "19:00", people: 2 },
      ]),
    },
    { id: L2, name: "Gebäude 5", openingHours: hours, staffingWindows: [] },
  ],
  employees: [emp(), emp({ id: B, firstName: "Ben", lastName: "Brandt" })],
  assignments: [],
  absences: [],
  rules: [],
  overrides: [],
  ...o,
});
const plan = (
  source: ScheduleWeek,
  targets: ScheduleWeek[],
  today = TODAY,
  locationIds = [L1],
) => planCopy({ source, targets, locationIds, today });

describe("planCopy", () => {
  it("maps weekdays into up to 4 targets", () => {
    const source = week(SRC, {
      assignments: [
        asg({}),
        asg({
          employeeId: B,
          date: "2026-11-18",
          start: "12:00",
          end: "19:00",
          shiftStart: "12:00",
          shiftEnd: "19:00",
        }),
      ],
    });
    const r = plan(source, [week(W1), week(W2), week(W3), week(W4)]);
    expect(
      r.create.map((c) => `${c.date} ${c.employeeId === A ? "A" : "B"}`),
    ).toEqual([
      "2026-11-23 A",
      "2026-11-25 B",
      "2026-11-30 A",
      "2026-12-02 B",
      "2026-12-07 A",
      "2026-12-09 B",
      "2026-12-14 A",
      "2026-12-16 B",
    ]);
    expect(r.skipped).toEqual([]);
  });

  it("ignores days before today silently", () => {
    const source = week(SRC, {
      assignments: [asg({}), asg({ date: "2026-11-18" })],
    });
    // target = current week, today Tuesday → Monday is ignored
    const r = plan(source, [week("2026-11-23")], "2026-11-24");
    expect(r.create.map((c) => c.date)).toEqual(["2026-11-25"]);
    expect(r.skipped).toEqual([]);
  });

  it("counts identical assignments as already present", () => {
    const source = week(SRC, { assignments: [asg({})] });
    const target = week(W1, { assignments: [asg({ date: W1 })] });
    const r = plan(source, [target]);
    expect(r).toMatchObject({ create: [], alreadyPresent: 1, skipped: [] });
  });

  it("skips inactive employees", () => {
    const source = week(SRC, { assignments: [asg({})] });
    const target = week(W1, { employees: [emp({ active: false })] });
    expect(plan(source, [target]).skipped[0]).toMatchObject({
      reason: "inactive",
      employeeName: "Müller, Anna",
      locationName: "Gebäude 21",
      date: W1,
    });
  });

  it("skips hard blocks: absence, rule, blocked location", () => {
    const source = week(SRC, {
      assignments: [
        asg({}),
        asg({
          employeeId: B,
          start: "12:00",
          end: "19:00",
          shiftStart: "12:00",
          shiftEnd: "19:00",
        }),
      ],
    });
    const vacation: Absence = {
      id: "01a1bb3f-0000-7000-8000-000000000051",
      employeeId: A,
      kind: "vacation",
      startDate: W1,
      endDate: W1,
      startTime: null,
      endTime: null,
      note: null,
      version: 1,
      updatedAt: T,
    };
    const r = plan(source, [
      week(W1, {
        absences: [vacation],
        rules: [
          {
            id: "01a1bb3f-0000-7000-8000-000000000061",
            employeeId: B,
            weekdays: ["mon"],
            startTime: "16:00",
            endTime: null,
            version: 1,
            updatedAt: T,
          },
        ],
      }),
      week(W2, {
        employees: [
          emp({
            locations: [
              { locationId: L1, trained: true, preference: "blocked" },
            ],
          }),
          emp({ id: B, firstName: "Ben", lastName: "Brandt" }),
        ],
      }),
    ]);
    expect(r.skipped.map((s) => `${s.date} ${s.reason}`)).toEqual([
      "2026-11-23 absence",
      "2026-11-23 rule",
      "2026-11-30 location_blocked",
    ]);
    expect(r.skipped[0]?.message).toBe("abwesend: Urlaub");
    expect(r.create.map((c) => c.date)).toEqual(["2026-11-30"]);
  });

  it("skips overlaps, also with assignments planned earlier in the same copy", () => {
    const source = week(SRC, {
      assignments: [
        asg({ locationId: L1 }),
        // same person, overlapping, other location (copied in one go)
        asg({
          locationId: L2,
          start: "11:00",
          end: "13:00",
          shiftStart: "11:00",
          shiftEnd: "13:00",
        }),
      ],
      locations: [
        week(SRC).locations[0] as ScheduleWeek["locations"][number],
        {
          id: L2,
          name: "Gebäude 5",
          openingHours: hours,
          staffingWindows: [
            { weekday: "mon", start: "11:00", end: "13:00", people: 1 },
          ],
        },
      ],
    });
    const target = week(W1, { locations: source.locations });
    const r = plan(source, [target], TODAY, [L1, L2]);
    expect(r.create).toHaveLength(1);
    expect(r.skipped[0]).toMatchObject({
      reason: "overlap",
      locationName: "Gebäude 5",
    });
  });

  it("skips changed, cancelled and missing shifts", () => {
    const ov = (o: Partial<ShiftOverride>): ShiftOverride => ({
      id: "01a1bb3f-0000-7000-8000-000000000081",
      locationId: L1,
      date: W1,
      kind: "cancelled",
      baseStart: "07:30",
      baseEnd: "12:00",
      start: null,
      end: null,
      people: null,
      version: 1,
      updatedAt: T,
      ...o,
    });
    const source = week(SRC, {
      assignments: [
        asg({}),
        asg({ date: "2026-11-19" }), // Thursday: no demand at all
      ],
    });
    const r = plan(source, [
      week(W1, { overrides: [ov({})] }),
      week(W2, {
        overrides: [
          ov({
            date: W2,
            kind: "changed",
            start: "08:00",
            end: "12:00",
            people: 1,
          }),
        ],
      }),
    ]);
    expect(r.skipped.map((s) => `${s.date} ${s.reason}`)).toEqual([
      "2026-11-23 no_shift",
      "2026-11-26 no_shift",
      "2026-11-30 no_shift",
      "2026-12-03 no_shift",
    ]);
    expect(r.create).toEqual([]);
  });

  it("does not overstaff: the first by start time wins", () => {
    const source = week(SRC, {
      assignments: [
        asg({ employeeId: B, start: "09:00" }),
        asg({ employeeId: A, start: "07:30" }),
      ],
    });
    const r = plan(source, [week(W1)]); // Soll 1 for 07:30–12:00
    expect(r.create.map((c) => c.employeeId)).toEqual([A]);
    expect(r.skipped[0]).toMatchObject({
      reason: "full",
      employeeName: "Brandt, Ben",
    });
  });

  it("copies despite soft warnings", () => {
    const source = week(SRC, { assignments: [asg({})] });
    const target = week(W1, {
      employees: [
        emp({
          weeklyTarget: 60,
          allowedShiftMinutes: [480],
          locations: [
            { locationId: L1, trained: false, preference: "neutral" },
          ],
        }),
      ],
    });
    expect(plan(source, [target]).create).toHaveLength(1);
  });
});

describe("CopyInput", () => {
  const base = { sourceStart: SRC, targetStarts: [W1], locationIds: [L1] };
  it("accepts a valid copy", () => {
    expect(CopyInput.safeParse(base).success).toBe(true);
  });
  it.each([
    ["not a Monday", { targetStarts: ["2026-11-24"] }],
    ["more than 4", { targetStarts: [W1, W2, W3, W4, "2026-12-21"] }],
    ["duplicates", { targetStarts: [W1, W1] }],
    ["target = source", { targetStarts: [SRC] }],
    ["no location", { locationIds: [] }],
  ])("refuses %s", (_, o) => {
    expect(CopyInput.safeParse({ ...base, ...o }).success).toBe(false);
  });
});

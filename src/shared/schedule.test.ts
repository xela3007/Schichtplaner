import { describe, expect, it } from "vitest";
import type { Absence, AvailabilityRule } from "./availability.js";
import {
  type Assignment,
  breakMinutes,
  coverageFor,
  coverageText,
  evaluateCandidate,
  isOutdated,
  netMinutes,
  type RuleContext,
  rankCandidates,
  type ScheduleEmployee,
  weekPlan,
} from "./schedule.js";

const T = "2026-11-08T08:00:00.000Z";
const L1 = "01a1bb3f-0000-7000-8000-000000000031";
const L2 = "01a1bb3f-0000-7000-8000-000000000032";
const A = "01a1bb3f-0000-7000-8000-000000000041";
const B = "01a1bb3f-0000-7000-8000-000000000042";
const MON = "2026-11-09";

const emp = (o: Partial<ScheduleEmployee> = {}): ScheduleEmployee => ({
  id: A,
  firstName: "Anna",
  lastName: "Müller",
  active: true,
  isFloater: false,
  weeklyTarget: 1800,
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
  date: MON,
  start: "08:00",
  end: "12:00",
  shiftStart: "08:00",
  shiftEnd: "12:00",
  version: 1,
  updatedAt: T,
  ...o,
});
const absence = (o: Partial<Absence>): Absence => ({
  id: "01a1bb3f-0000-7000-8000-000000000051",
  employeeId: A,
  kind: "vacation",
  startDate: MON,
  endDate: MON,
  startTime: null,
  endTime: null,
  note: null,
  version: 1,
  updatedAt: T,
  ...o,
});
const rule = (o: Partial<AvailabilityRule>): AvailabilityRule => ({
  id: "01a1bb3f-0000-7000-8000-000000000061",
  employeeId: A,
  weekdays: ["mon", "tue", "wed", "thu", "fri"],
  startTime: "16:00",
  endTime: null,
  version: 1,
  updatedAt: T,
  ...o,
});
const ctx = (o: Partial<RuleContext> = {}): RuleContext => ({
  today: "2026-11-08",
  employee: emp(),
  locationId: L1,
  locationNames: { [L1]: "Gebäude 21", [L2]: "Gebäude 5" },
  absences: [],
  rules: [],
  assignments: [],
  ...o,
});
const codes = (r: {
  blocks: { code: string }[];
  warnings: { code: string }[];
}) => ({
  blocks: r.blocks.map((x) => x.code),
  warnings: r.warnings.map((x) => x.code),
});
const slot = { date: MON, start: "08:00", end: "16:00" };

describe("blocks", () => {
  it("past day, hard absence (all-day and timed), rule, blocked location, overlap anywhere", () => {
    expect(
      codes(evaluateCandidate(ctx({ today: "2026-11-10" }), slot)).blocks,
    ).toEqual(["past"]);
    expect(
      codes(evaluateCandidate(ctx({ absences: [absence({})] }), slot)).blocks,
    ).toEqual(["absence"]);
    expect(
      codes(
        evaluateCandidate(
          ctx({
            absences: [
              absence({
                kind: "appointment",
                startTime: "16:00",
                endTime: "18:00",
              }),
            ],
          }),
          slot,
        ),
      ).blocks,
    ).toEqual([]); // touching, not overlapping
    expect(
      codes(
        evaluateCandidate(ctx({ rules: [rule({})] }), {
          ...slot,
          end: "19:00",
        }),
      ).blocks,
    ).toEqual(["rule"]);
    expect(
      codes(evaluateCandidate(ctx({ rules: [rule({})] }), slot)).blocks,
    ).toEqual([]);
    expect(
      codes(
        evaluateCandidate(
          ctx({ rules: [rule({ startTime: null, endTime: "10:00" })] }),
          slot,
        ),
      ).blocks,
    ).toEqual(["rule"]);
    expect(
      codes(
        evaluateCandidate(
          ctx({
            employee: emp({
              locations: [
                { locationId: L1, trained: true, preference: "blocked" },
              ],
            }),
          }),
          slot,
        ),
      ).blocks,
    ).toEqual(["location_blocked"]);
    const r = evaluateCandidate(
      ctx({
        assignments: [asg({ locationId: L2, start: "15:00", end: "18:00" })],
      }),
      slot,
    );
    expect(r.blocks[0]?.message).toBe("zeitgleich in Gebäude 5 15:00–18:00");
    expect(
      codes(
        evaluateCandidate(
          ctx({ assignments: [asg({ start: "16:00", end: "18:00" })] }),
          slot,
        ),
      ).blocks,
    ).toEqual([]);
  });
});

describe("warnings", () => {
  it("wish off, not trained (not for Springer), shift length, max daily, over weekly", () => {
    expect(
      codes(
        evaluateCandidate(
          ctx({ absences: [absence({ kind: "wish_off" })] }),
          slot,
        ),
      ),
    ).toEqual({
      blocks: [],
      warnings: ["wish_off"],
    });
    expect(
      codes(evaluateCandidate(ctx({ locationId: L2 }), slot)).warnings,
    ).toEqual(["not_trained"]);
    expect(
      codes(
        evaluateCandidate(
          ctx({ locationId: L2, employee: emp({ isFloater: true }) }),
          slot,
        ),
      ).warnings,
    ).toEqual([]);
    expect(
      codes(
        evaluateCandidate(
          ctx({ employee: emp({ allowedShiftMinutes: [360, 480] }) }),
          { ...slot, end: "15:30" },
        ),
      ).warnings,
    ).toEqual(["shift_length"]);
    expect(
      codes(
        evaluateCandidate(
          ctx({
            employee: emp({ maxDailyMinutes: 480 }),
            assignments: [asg({ start: "17:00", end: "19:00" })],
          }),
          slot,
        ),
      ).warnings,
    ).toEqual(["max_daily"]);
    const week = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"].map(
      (date) => asg({ date, start: "08:00", end: "16:00" }),
    );
    // 4 × 7,5 h net = 30 h; another day → over 30 h
    expect(
      codes(evaluateCandidate(ctx({ assignments: week }), slot)).warnings,
    ).toEqual(["over_weekly"]);
  });
});

describe("hours", () => {
  it("breaks per day on summed gross time", () => {
    expect(breakMinutes(360)).toBe(0);
    expect(breakMinutes(361)).toBe(30);
    expect(breakMinutes(541)).toBe(45);
    // 08–12 + 13–18 = 9 h gross → 30 min; 08–18 = 10 h → 45 min
    expect(
      netMinutes([
        asg({ start: "08:00", end: "12:00" }),
        asg({ start: "13:00", end: "18:00" }),
      ]),
    ).toBe(510);
    expect(netMinutes([asg({ start: "08:00", end: "18:00" })])).toBe(555);
  });
  it("week plan uses the target (override already resolved)", () => {
    const plan = weekPlan(emp({ weeklyTarget: 1920 }), [
      asg({ start: "08:00", end: "16:00" }),
    ]);
    expect(plan).toEqual({ plannedNet: 450, target: 1920, free: 1470 });
  });
});

describe("coverage and outdated", () => {
  const loc = {
    openingHours: [{ weekday: "mon" as const, start: "07:30", end: "19:00" }],
    staffingWindows: [
      { weekday: "mon", start: "07:30", end: "19:00", people: 2 },
      { weekday: "mon", start: "08:00", end: "10:00", people: 2 },
    ],
  };
  it("minute-exact gaps and overstaffing with overlapping windows and partial shifts", () => {
    const seg = coverageFor(loc, MON, [
      asg({ start: "07:30", end: "19:00" }),
      asg({ employeeId: B, start: "07:30", end: "12:00" }),
    ]);
    expect(coverageText(seg).lines).toEqual([
      "Lücke 08:00–10:00 (2 fehlt)",
      "Lücke 12:00–19:00 (1 fehlt)",
    ]);
    const full = coverageFor(loc, MON, [
      asg({ start: "07:30", end: "19:00" }),
      asg({ start: "07:30", end: "19:00" }),
      asg({ start: "08:00", end: "10:00" }),
      asg({ start: "08:00", end: "11:00" }),
    ]);
    expect(coverageText(full)).toEqual({
      status: "over",
      lines: ["überbesetzt 10:00–11:00 (+1)"],
    });
  });
  it("detects outdated assignments", () => {
    expect(
      isOutdated(
        asg({
          start: "07:30",
          end: "19:00",
          shiftStart: "07:30",
          shiftEnd: "19:00",
        }),
        loc,
      ),
    ).toBe(false);
    expect(
      isOutdated(
        asg({
          start: "07:30",
          end: "19:00",
          shiftStart: "07:30",
          shiftEnd: "18:00",
        }),
        loc,
      ),
    ).toBe(true);
    expect(
      isOutdated(
        asg({
          start: "07:00",
          end: "12:00",
          shiftStart: "07:30",
          shiftEnd: "19:00",
        }),
        loc,
      ),
    ).toBe(true);
  });
});

describe("ranking", () => {
  it("not blocked, trained, preferred, free hours, name", () => {
    const week = {
      today: "2026-11-08",
      locations: [
        { id: L1, name: "Gebäude 21", openingHours: [], staffingWindows: [] },
      ],
      employees: [
        emp({ id: A, lastName: "Blockiert" }),
        emp({ id: B, lastName: "Neutral" }),
        emp({
          id: "01a1bb3f-0000-7000-8000-000000000043",
          lastName: "Bevorzugt",
          locations: [
            { locationId: L1, trained: true, preference: "preferred" },
          ],
        }),
        emp({
          id: "01a1bb3f-0000-7000-8000-000000000044",
          lastName: "Fremd",
          locations: [],
        }),
        emp({
          id: "01a1bb3f-0000-7000-8000-000000000045",
          lastName: "Inaktiv",
          active: false,
        }),
      ],
      assignments: [],
      absences: [absence({ employeeId: A })],
      rules: [],
    };
    expect(
      rankCandidates(week, L1, slot).map((r) => r.employee.lastName),
    ).toEqual(["Bevorzugt", "Neutral", "Fremd", "Blockiert"]);
  });
});

describe("day overrides (Teil 2)", () => {
  const LOC = "01a1bb3f-0000-7000-8000-000000000031";
  const loc = {
    id: LOC,
    openingHours: [{ weekday: "mon" as const, start: "07:30", end: "19:00" }],
    staffingWindows: [
      { weekday: "mon", start: "07:30", end: "19:00", people: 2 },
      { weekday: "mon", start: "08:00", end: "10:00", people: 2 },
    ],
  };
  const ov = (o: Partial<import("./schedule.js").ShiftOverride>) => ({
    id: "01a1bb3f-0000-7000-8000-000000000081",
    locationId: LOC,
    date: MON,
    kind: "added" as const,
    baseStart: null,
    baseEnd: null,
    start: null,
    end: null,
    people: null,
    version: 1,
    updatedAt: T,
    ...o,
  });
  it("applies added, changed and cancelled; vanished base keeps a change", async () => {
    const { effectiveShifts } = await import("./schedule.js");
    const r = effectiveShifts(loc, MON, [
      ov({ kind: "added", start: "17:00", end: "21:00", people: 2 }),
      ov({
        id: "01a1bb3f-0000-7000-8000-000000000082",
        kind: "changed",
        baseStart: "07:30",
        baseEnd: "19:00",
        start: "07:30",
        end: "15:00",
        people: 3,
      }),
      ov({
        id: "01a1bb3f-0000-7000-8000-000000000083",
        kind: "cancelled",
        baseStart: "08:00",
        baseEnd: "10:00",
      }),
    ]);
    expect(
      r.shifts.map((s) => `${s.start}-${s.end}:${s.people}:${s.source}`),
    ).toEqual(["07:30-15:00:3:changed", "17:00-21:00:2:added"]);
    expect(r.cancelled[0]?.base).toEqual({ start: "08:00", end: "10:00" });
    const vanished = effectiveShifts({ ...loc, staffingWindows: [] }, MON, [
      ov({
        kind: "changed",
        baseStart: "07:30",
        baseEnd: "19:00",
        start: "09:00",
        end: "12:00",
        people: 1,
      }),
    ]);
    expect(vanished.shifts.map((s) => s.source)).toEqual(["changed"]);
    // other days and locations are not affected
    expect(
      effectiveShifts(loc, "2026-11-23", [
        ov({ kind: "added", start: "17:00", end: "21:00", people: 2 }),
      ]).shifts,
    ).toHaveLength(2);
  });

  it("coverage, outdated and window checks use the effective shifts", async () => {
    const { coverageFor, coverageText, isOutdated, assignmentWindowOk } =
      await import("./schedule.js");
    const added = ov({
      kind: "added",
      start: "17:00",
      end: "21:00",
      people: 1,
    });
    const evening = asg({
      start: "18:00",
      end: "21:00",
      shiftStart: "17:00",
      shiftEnd: "21:00",
    });
    expect(
      coverageText(coverageFor(loc, MON, [evening], [added])).lines,
    ).toContain("Lücke 17:00–18:00 (3 fehlt)");
    expect(assignmentWindowOk(loc, [added], evening)).toBe(true);
    expect(assignmentWindowOk(loc, [], evening)).toBe(false);
    expect(isOutdated(evening, loc, [added])).toBe(false);
    expect(isOutdated(evening, loc, [])).toBe(true);
    const cancelled = ov({
      kind: "cancelled",
      baseStart: "08:00",
      baseEnd: "10:00",
    });
    const lines = coverageText(coverageFor(loc, MON, [], [cancelled])).lines;
    expect(lines).toEqual(["Lücke 07:30–19:00 (2 fehlt)"]);
  });

  it("affected assignments: fitting ones stay, the rest is listed", async () => {
    const { affectedAssignments } = await import("./schedule.js");
    const full = asg({
      start: "07:30",
      end: "19:00",
      shiftStart: "07:30",
      shiftEnd: "19:00",
    });
    const part = asg({
      employeeId: B,
      start: "08:00",
      end: "12:00",
      shiftStart: "07:30",
      shiftEnd: "19:00",
    });
    const other = asg({
      start: "08:00",
      end: "10:00",
      shiftStart: "08:00",
      shiftEnd: "10:00",
    });
    const r = affectedAssignments(
      [full, part, other],
      LOC,
      MON,
      { start: "07:30", end: "19:00" },
      { start: "07:30", end: "15:00" },
    );
    expect(r.keep).toEqual([part]);
    expect(r.remove).toEqual([full]);
    expect(
      affectedAssignments(
        [full, part, other],
        LOC,
        MON,
        { start: "07:30", end: "19:00" },
        null,
      ).remove,
    ).toHaveLength(2);
  });
});

describe("demand edited after an override", () => {
  it("the override keeps owning its slot; untouched windows stay", async () => {
    const { effectiveShifts } = await import("./schedule.js");
    const L = "01a1bb3f-0000-7000-8000-000000000031";
    const loc = {
      id: L,
      staffingWindows: [
        { weekday: "mon", start: "07:30", end: "16:00", people: 2 }, // was 07:30–17:00
        { weekday: "mon", start: "08:00", end: "10:00", people: 2 },
      ],
    };
    const o = {
      id: "01a1bb3f-0000-7000-8000-000000000081",
      locationId: L,
      date: MON,
      kind: "changed" as const,
      baseStart: "07:30",
      baseEnd: "17:00",
      start: "07:30",
      end: "15:00",
      people: 2,
      version: 1,
      updatedAt: T,
    };
    const r = effectiveShifts(loc, MON, [o]).shifts.map(
      (s) => `${s.start}-${s.end}:${s.source}`,
    );
    expect(r).toEqual(["07:30-15:00:changed", "08:00-10:00:standard"]);
    // other Mondays get the new standard
    expect(
      effectiveShifts(loc, "2026-11-23", [o]).shifts.map(
        (s) => `${s.start}-${s.end}`,
      ),
    ).toEqual(["07:30-16:00", "08:00-10:00"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  AbsenceInput,
  absencesOn,
  addDays,
  formatAbsence,
  formatRule,
  isoWeek,
  isSoft,
  mondayOf,
  RuleInput,
  rulesOn,
  weekDays,
  weekdayOf,
} from "./availability.js";

const issues = (
  schema: {
    safeParse: (v: unknown) => {
      error?: { issues: { path: PropertyKey[] }[] };
    };
  },
  v: unknown,
) => schema.safeParse(v).error?.issues.map((i) => i.path.join("."));

describe("dates", () => {
  it("weekday, monday and week days work across year change and DST", () => {
    expect(weekdayOf("2026-11-08")).toBe("sun");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
    expect(weekDays("2026-12-28")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
    // DST end 25.10.2026 — still exactly one day steps
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(mondayOf("2026-03-29")).toBe("2026-03-23");
  });
  it("ISO week numbers", () => {
    expect(isoWeek("2026-11-09")).toBe(46);
    expect(isoWeek("2027-01-01")).toBe(53);
    expect(isoWeek("2027-01-04")).toBe(1);
  });
});

describe("AbsenceInput", () => {
  const base = {
    kind: "vacation",
    startDate: "2026-10-05",
    endDate: "2026-10-16",
  };
  it("multi-day all-day, single-day with times", () => {
    expect(AbsenceInput.parse(base)).toMatchObject({
      startTime: null,
      endTime: null,
      note: null,
    });
    expect(
      AbsenceInput.parse({
        kind: "appointment",
        startDate: "2026-10-20",
        endDate: "2026-10-20",
        startTime: "14:00",
        endTime: "16:00",
      }),
    ).toMatchObject({ startTime: "14:00" });
  });
  it("rejects times on multi-day, half times, reversed ranges, impossible dates, > 1 year", () => {
    expect(
      issues(AbsenceInput, { ...base, startTime: "08:00", endTime: "12:00" }),
    ).toEqual(["startTime"]);
    expect(
      issues(AbsenceInput, {
        ...base,
        endDate: base.startDate,
        startTime: "08:00",
      }),
    ).toEqual(["endTime"]);
    expect(issues(AbsenceInput, { ...base, endDate: "2026-10-01" })).toEqual([
      "endDate",
    ]);
    expect(
      issues(AbsenceInput, {
        ...base,
        endDate: base.startDate,
        startTime: "12:00",
        endTime: "08:00",
      }),
    ).toEqual(["endTime"]);
    expect(
      issues(AbsenceInput, { ...base, startDate: "2026-02-31" })?.[0],
    ).toBe("startDate");
    expect(issues(AbsenceInput, { ...base, endDate: "2027-10-06" })).toEqual([
      "endDate",
    ]);
  });
  it("only Wunsch frei is soft", () => {
    expect(isSoft("wish_off")).toBe(true);
    expect(isSoft("absent")).toBe(false);
  });
});

describe("RuleInput", () => {
  it("sorts weekdays, requires one, checks windows", () => {
    expect(RuleInput.parse({ weekdays: ["fri", "mon"] }).weekdays).toEqual([
      "mon",
      "fri",
    ]);
    expect(issues(RuleInput, { weekdays: [] })).toEqual(["weekdays"]);
    expect(
      issues(RuleInput, {
        weekdays: ["mon"],
        startTime: "12:00",
        endTime: "10:00",
      }),
    ).toEqual(["endTime"]);
    expect(
      RuleInput.parse({ weekdays: ["mon"], startTime: "16:00" }),
    ).toMatchObject({ endTime: null });
  });
});

describe("lookups and formatting", () => {
  it("absences across week boundaries, rules by weekday", () => {
    const a = [{ startDate: "2026-10-28", endDate: "2026-11-03" }];
    expect(absencesOn(a, "2026-11-02")).toHaveLength(1);
    expect(absencesOn(a, "2026-11-04")).toHaveLength(0);
    const r = [{ weekdays: ["tue" as const] }];
    expect(rulesOn(r, "2026-11-10")).toHaveLength(1);
    expect(rulesOn(r, "2026-11-11")).toHaveLength(0);
  });
  it("formats absences and rules", () => {
    expect(
      formatAbsence({
        kind: "vacation",
        startDate: "2026-10-05",
        endDate: "2026-10-16",
        startTime: null,
        endTime: null,
      }),
    ).toBe("Urlaub · 05.10.–16.10.2026");
    expect(
      formatAbsence({
        kind: "appointment",
        startDate: "2026-10-20",
        endDate: "2026-10-20",
        startTime: "14:00",
        endTime: "16:00",
      }),
    ).toBe("Termin / Weiterbildung · 20.10.2026, 14:00–16:00");
    expect(
      formatAbsence({
        kind: "vacation",
        startDate: "2026-12-28",
        endDate: "2027-01-02",
        startTime: null,
        endTime: null,
      }),
    ).toBe("Urlaub · 28.12.2026–02.01.2027");
    const r = (
      weekdays: string[],
      startTime: string | null = null,
      endTime: string | null = null,
    ) => formatRule({ weekdays: weekdays as never, startTime, endTime });
    expect(r(["mon", "tue", "wed", "thu", "fri"], "16:00")).toBe(
      "Mo–Fr ab 16:00",
    );
    expect(r(["tue"])).toBe("Di ganztägig");
    expect(
      r(["mon", "tue", "wed", "thu", "fri", "sat", "sun"], null, "10:00"),
    ).toBe("täglich vor 10:00");
    expect(r(["mon", "wed", "fri"], "10:00", "12:00")).toBe(
      "Mo, Mi, Fr 10:00–12:00",
    );
    expect(r(["sat", "sun"])).toBe("Sa, So ganztägig");
  });
});

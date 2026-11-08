import { describe, expect, it } from "vitest";
import type { OpeningHours, Weekday } from "./locations.js";
import {
  computeCoverage,
  StaffingWindows,
  windowsOutsideOpeningHours,
} from "./staffing.js";

const o = (weekday: string, start: string, end: string) =>
  ({ weekday, start, end }) as OpeningHours[number];
const w = (weekday: Weekday, start: string, end: string, people: number) => ({
  weekday,
  start,
  end,
  people,
});

const G21: OpeningHours = ["mon", "tue", "wed", "thu", "fri"].map((d) =>
  o(d, "07:30", "19:00"),
);

describe("windowsOutsideOpeningHours", () => {
  it("accepts windows inside, rejects windows beyond the hours or on closed days", () => {
    const windows = [
      w("mon", "07:30", "19:00", 2),
      w("mon", "18:00", "20:00", 1),
      w("sat", "09:00", "12:00", 1),
    ];
    expect(windowsOutsideOpeningHours(windows, G21)).toEqual([1, 2]);
  });

  it("rejects a window spanning a lunch gap (must fit ONE opening range)", () => {
    const lunch: OpeningHours = [
      o("mon", "08:00", "12:00"),
      o("mon", "13:00", "17:00"),
    ];
    expect(
      windowsOutsideOpeningHours([w("mon", "11:00", "14:00", 1)], lunch),
    ).toEqual([0]);
    expect(
      windowsOutsideOpeningHours([w("mon", "13:00", "17:00", 1)], lunch),
    ).toEqual([]);
  });
});

describe("computeCoverage", () => {
  it("adds overlapping windows (base 2 + peak 2 = 4)", () => {
    const cov = computeCoverage(G21, [
      w("mon", "07:30", "19:00", 2),
      w("mon", "08:00", "10:00", 2),
    ]);
    expect(cov.mon).toEqual([
      { start: "07:30", end: "08:00", required: 2, status: "covered" },
      { start: "08:00", end: "10:00", required: 4, status: "covered" },
      { start: "10:00", end: "19:00", required: 2, status: "covered" },
    ]);
  });

  it("marks opening time without demand as gap and merges equal neighbours", () => {
    const cov = computeCoverage(G21, [
      w("mon", "07:30", "12:00", 2),
      w("mon", "12:00", "15:00", 2),
    ]);
    expect(cov.mon).toEqual([
      { start: "07:30", end: "15:00", required: 2, status: "covered" },
      { start: "15:00", end: "19:00", required: 0, status: "gap" },
    ]);
    expect(cov.tue).toEqual([
      { start: "07:30", end: "19:00", required: 0, status: "gap" },
    ]);
    expect(cov.sat).toEqual([]);
  });

  it("marks demand beyond shortened opening hours as outside", () => {
    const shortened = G21.map((r) =>
      r.weekday === "mon" ? o("mon", "07:30", "17:00") : r,
    );
    const cov = computeCoverage(shortened, [w("mon", "07:30", "19:00", 2)]);
    expect(cov.mon).toEqual([
      { start: "07:30", end: "17:00", required: 2, status: "covered" },
      { start: "17:00", end: "19:00", required: 2, status: "outside" },
    ]);
  });

  it("touching windows don't double-count the boundary", () => {
    const cov = computeCoverage(G21, [
      w("wed", "07:30", "12:00", 3),
      w("wed", "12:00", "19:00", 1),
    ]);
    expect(cov.wed.map((s) => s.required)).toEqual([3, 1]);
  });
});

describe("StaffingWindows", () => {
  it("validates people 1–20 and start < end", () => {
    expect(
      StaffingWindows.safeParse([w("mon", "08:00", "12:00", 0)]).success,
    ).toBe(false);
    expect(
      StaffingWindows.safeParse([w("mon", "08:00", "12:00", 21)]).success,
    ).toBe(false);
    expect(
      StaffingWindows.safeParse([w("mon", "12:00", "08:00", 2)]).success,
    ).toBe(false);
    expect(
      StaffingWindows.safeParse([w("mon", "08:00", "12:00", 20)]).success,
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import * as f from "@/test-support/schedule-fixtures";
import { employeeColor, layoutLanes, timeRange } from "./timeline";

const it_ = (start: string, end: string) => ({ start, end });

describe("layoutLanes", () => {
  it("keeps separate times in one lane", () => {
    const a = it_("07:30", "12:00");
    const b = it_("12:00", "19:00");
    const m = layoutLanes([a, b]);
    expect(m.get(a)).toEqual({ lane: 0, lanes: 1 });
    expect(m.get(b)).toEqual({ lane: 0, lanes: 1 });
  });
  it("puts three overlapping items side by side", () => {
    const xs = [
      it_("08:00", "12:00"),
      it_("09:00", "13:00"),
      it_("10:00", "11:00"),
    ];
    const m = layoutLanes(xs);
    expect(xs.map((x) => m.get(x)?.lane).sort()).toEqual([0, 1, 2]);
    expect(xs.every((x) => m.get(x)?.lanes === 3)).toBe(true);
  });
  it("reuses a freed lane within a chained cluster", () => {
    const a = it_("08:00", "10:00");
    const b = it_("09:00", "12:00");
    const c = it_("10:00", "11:00"); // fits where a ended
    const d = it_("14:00", "15:00"); // new cluster
    const m = layoutLanes([a, b, c, d]);
    expect(m.get(c)).toEqual({ lane: 0, lanes: 2 });
    expect(m.get(b)).toEqual({ lane: 1, lanes: 2 });
    expect(m.get(d)).toEqual({ lane: 0, lanes: 1 });
  });
});

describe("timeRange", () => {
  const week = f.week();
  const loc = week.locations[0] as never;
  const days = ["2026-11-16", "2026-11-17"];
  it("covers opening hours rounded to whole hours", () => {
    expect(timeRange(loc, days, [])).toEqual({ from: 7, to: 19 });
  });
  it("stretches for an evening assignment", () => {
    expect(
      timeRange(loc, days, [
        { date: "2026-11-16", start: "18:00", end: "21:30" },
      ]),
    ).toEqual({ from: 7, to: 22 });
  });
});

describe("employeeColor", () => {
  it("is stable per id", () => {
    expect(employeeColor(f.ANNA)).toBe(employeeColor(f.ANNA));
  });
});

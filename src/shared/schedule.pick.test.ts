import { describe, expect, it } from "vitest";
import { type ShiftOverride, shiftsAt, snapRange, toMin } from "./schedule.js";

const L1 = "01a1bb3f-0000-7000-8000-000000000031";
const MON = "2026-11-09";
const loc = {
  id: L1,
  staffingWindows: [
    { weekday: "mon" as const, start: "07:30", end: "17:00", people: 2 },
    { weekday: "mon" as const, start: "08:00", end: "10:00", people: 1 },
  ],
};
const a = (
  start: string,
  end: string,
  shiftStart: string,
  shiftEnd: string,
) => ({
  locationId: L1,
  date: MON,
  start,
  end,
  shiftStart,
  shiftEnd,
});

describe("shiftsAt", () => {
  it("returns nothing outside every shift", () => {
    expect(shiftsAt(loc, MON, [], [], toMin("06:00"))).toEqual([]);
    expect(shiftsAt(loc, MON, [], [], toMin("17:00"))).toEqual([]);
  });

  it("returns the one shift covering the minute with its gap", () => {
    const r = shiftsAt(
      loc,
      MON,
      [],
      [a("07:30", "12:00", "07:30", "17:00")],
      toMin("11:00"),
    );
    expect(r.map((s) => [s.start, s.gap])).toEqual([["07:30", 1]]);
  });

  it("orders overlapping shifts by the largest gap at that minute", () => {
    // long shift fully staffed at 09:00, short one empty → short first
    const r = shiftsAt(
      loc,
      MON,
      [],
      [
        a("07:30", "17:00", "07:30", "17:00"),
        a("08:00", "12:00", "07:30", "17:00"),
      ],
      toMin("09:00"),
    );
    expect(r.map((s) => `${s.start}-${s.end}:${s.gap}`)).toEqual([
      "08:00-10:00:1",
      "07:30-17:00:0",
    ]);
  });

  it("ties go to the earlier start, then the shorter shift", () => {
    const same = {
      id: L1,
      staffingWindows: [
        { weekday: "mon" as const, start: "08:00", end: "12:00", people: 1 },
        { weekday: "mon" as const, start: "08:00", end: "10:00", people: 1 },
        { weekday: "mon" as const, start: "07:00", end: "11:00", people: 1 },
      ],
    };
    expect(
      shiftsAt(same, MON, [], [], toMin("09:00")).map(
        (s) => `${s.start}-${s.end}`,
      ),
    ).toEqual(["07:00-11:00", "08:00-10:00", "08:00-12:00"]);
  });

  it("uses effective shifts: added and cancelled overrides count", () => {
    const ov = (o: Partial<ShiftOverride>): ShiftOverride => ({
      id: "01a1bb3f-0000-7000-8000-000000000071",
      locationId: L1,
      date: MON,
      kind: "added",
      baseStart: null,
      baseEnd: null,
      start: null,
      end: null,
      people: null,
      version: 1,
      updatedAt: "2026-11-08T08:00:00.000Z",
      ...o,
    });
    const overrides = [
      ov({ kind: "added", start: "17:00", end: "21:00", people: 2 }),
      ov({
        id: "01a1bb3f-0000-7000-8000-000000000072",
        kind: "cancelled",
        baseStart: "08:00",
        baseEnd: "10:00",
      }),
    ];
    expect(
      shiftsAt(loc, MON, overrides, [], toMin("18:00")).map((s) => s.start),
    ).toEqual(["17:00"]);
    expect(
      shiftsAt(loc, MON, overrides, [], toMin("09:00")).map((s) => s.start),
    ).toEqual(["07:30"]);
  });
});

describe("snapRange", () => {
  const shift = { start: "07:30", end: "17:00" };

  it("snaps outward to 30 minutes", () => {
    expect(snapRange(toMin("08:10"), toMin("10:40"), shift)).toEqual({
      start: "08:00",
      end: "11:00",
      clipped: false,
    });
  });

  it("works when dragged upwards", () => {
    expect(snapRange(toMin("12:20"), toMin("09:50"), shift)).toEqual({
      start: "09:30",
      end: "12:30",
      clipped: false,
    });
  });

  it("keeps at least one 30-minute step", () => {
    expect(snapRange(toMin("09:00"), toMin("09:00"), shift)).toEqual({
      start: "09:00",
      end: "09:30",
      clipped: false,
    });
  });

  it("clips to the shift and flags it", () => {
    expect(snapRange(toMin("15:10"), toMin("18:20"), shift)).toEqual({
      start: "15:00",
      end: "17:00",
      clipped: true,
    });
    expect(snapRange(toMin("07:40"), toMin("06:10"), shift)).toEqual({
      start: "07:30",
      end: "08:00",
      clipped: true,
    });
  });

  it("does not flag snapping onto an off-grid shift edge as clipping", () => {
    const odd = { start: "07:45", end: "16:45" };
    expect(snapRange(toMin("07:50"), toMin("08:20"), odd)).toEqual({
      start: "07:45",
      end: "08:30",
      clipped: false,
    });
  });
});

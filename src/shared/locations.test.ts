import { describe, expect, it } from "vitest";
import { LocationInput, OpeningHours, TimeOfDay } from "./locations.js";

const r = (weekday: string, start: string, end: string) => ({
  weekday,
  start,
  end,
});

describe("TimeOfDay", () => {
  it("accepts HH:MM and rejects everything else", () => {
    expect(TimeOfDay.safeParse("07:30").success).toBe(true);
    expect(TimeOfDay.safeParse("23:59").success).toBe(true);
    for (const bad of ["7:30", "24:00", "07:60", "0730", ""]) {
      expect(TimeOfDay.safeParse(bad).success).toBe(false);
    }
  });
});

describe("OpeningHours", () => {
  it("allows several ranges per day and touching ranges", () => {
    expect(
      OpeningHours.safeParse([
        r("mon", "08:00", "12:00"),
        r("mon", "12:00", "17:00"),
      ]).success,
    ).toBe(true);
  });

  it("rejects overlapping ranges on the same day, pointing at the later one", () => {
    const result = OpeningHours.safeParse([
      r("tue", "11:00", "15:00"),
      r("tue", "08:00", "12:00"),
    ]);
    expect(result.success).toBe(false);
    const issue = result.error?.issues[0];
    expect(issue?.message).toContain("Überschneidet sich mit 08:00–12:00");
    expect(issue?.path).toEqual([0, "start"]);
  });

  it("allows the same times on different days", () => {
    expect(
      OpeningHours.safeParse([
        r("mon", "08:00", "12:00"),
        r("tue", "08:00", "12:00"),
      ]).success,
    ).toBe(true);
  });

  it("rejects end before start and ranges over midnight", () => {
    expect(OpeningHours.safeParse([r("wed", "12:00", "08:00")]).success).toBe(
      false,
    );
    expect(OpeningHours.safeParse([r("wed", "22:00", "02:00")]).success).toBe(
      false,
    );
    expect(OpeningHours.safeParse([r("wed", "08:00", "08:00")]).success).toBe(
      false,
    );
  });

  it("rejects more than 6 ranges per day", () => {
    const seven = Array.from({ length: 7 }, (_, i) =>
      r("thu", `0${i}:00`, `0${i}:30`),
    );
    const result = OpeningHours.safeParse(seven);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("Höchstens 6");
  });

  it("an empty list is valid (closed)", () => {
    expect(OpeningHours.safeParse([]).success).toBe(true);
  });
});

describe("LocationInput", () => {
  it("trims the name and requires kind", () => {
    const ok = LocationInput.parse({
      name: "  Gebäude 21 ",
      kind: "customer_area",
      openingHours: [],
    });
    expect(ok.name).toBe("Gebäude 21");
    expect(
      LocationInput.safeParse({
        name: " ",
        kind: "customer_area",
        openingHours: [],
      }).success,
    ).toBe(false);
    expect(
      LocationInput.safeParse({ name: "X", kind: "garage", openingHours: [] })
        .success,
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { ContractTypeInput, hoursChanged } from "./catalogs.js";

const base = { name: "30-Std.-Vertrag", weeklyMinutes: 1800 };

describe("ContractTypeInput", () => {
  it("only weekly hours are required; optional fields default", () => {
    expect(ContractTypeInput.parse(base)).toEqual({
      ...base,
      typicalShiftMinutes: null,
      allowedShiftMinutes: [],
      maxDailyMinutes: null,
    });
  });

  it("sorts allowed lengths and rejects duplicates", () => {
    expect(
      ContractTypeInput.parse({ ...base, allowedShiftMinutes: [480, 360] })
        .allowedShiftMinutes,
    ).toEqual([360, 480]);
    expect(
      ContractTypeInput.safeParse({ ...base, allowedShiftMinutes: [360, 360] })
        .success,
    ).toBe(false);
  });

  it("allowed and typical lengths must fit into max per day; typical must be allowed", () => {
    const issues = (v: object) =>
      ContractTypeInput.safeParse({ ...base, ...v }).error?.issues.map((i) =>
        i.path.join("."),
      );
    expect(
      issues({ allowedShiftMinutes: [360, 600], maxDailyMinutes: 480 }),
    ).toEqual(["allowedShiftMinutes"]);
    expect(issues({ typicalShiftMinutes: 540, maxDailyMinutes: 480 })).toEqual([
      "typicalShiftMinutes",
    ]);
    expect(
      issues({ typicalShiftMinutes: 300, allowedShiftMinutes: [360, 480] }),
    ).toEqual(["typicalShiftMinutes"]);
    expect(
      issues({
        typicalShiftMinutes: 360,
        allowedShiftMinutes: [360, 480],
        maxDailyMinutes: 480,
      }),
    ).toBeUndefined();
  });

  it("rejects weekly hours outside 1–60 h", () => {
    expect(
      ContractTypeInput.safeParse({ ...base, weeklyMinutes: 30 }).success,
    ).toBe(false);
    expect(
      ContractTypeInput.safeParse({ ...base, weeklyMinutes: 3700 }).success,
    ).toBe(false);
  });
});

describe("hoursChanged", () => {
  const h = {
    weeklyMinutes: 1800,
    typicalShiftMinutes: null,
    allowedShiftMinutes: [360],
    maxDailyMinutes: 480,
  };
  it("detects any duration change, ignores identical values", () => {
    expect(hoursChanged(h, { ...h })).toBe(false);
    expect(hoursChanged(h, { ...h, allowedShiftMinutes: [360, 480] })).toBe(
      true,
    );
    expect(hoursChanged(h, { ...h, weeklyMinutes: 1920 })).toBe(true);
  });
});

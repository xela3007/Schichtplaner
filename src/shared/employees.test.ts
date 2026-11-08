import { describe, expect, it } from "vitest";
import {
  EmployeeInput,
  effectiveWeeklyMinutes,
  formatMobile,
  isTrainedAt,
  matchesSearch,
  normalizeMobile,
  preferenceAt,
} from "./employees.js";

const CT = "01a1ba68-3ba1-730f-b93a-57fda87a0001";
const L1 = "01a1ba68-3ba1-730f-b93a-57fda87a0101";
const L2 = "01a1ba68-3ba1-730f-b93a-57fda87a0102";
const base = {
  firstName: "Anna",
  lastName: "Müller",
  mobile: "0151 23456789",
  contractTypeId: CT,
};

describe("phone numbers", () => {
  it("normalises national and international input to E.164", () => {
    expect(normalizeMobile("0151 23456789")).toBe("+4915123456789");
    expect(normalizeMobile("+43 664 1234567")).toBe("+436641234567");
    expect(normalizeMobile("hallo")).toBeNull();
    expect(normalizeMobile("123")).toBeNull();
    // grouping follows the national numbering plan (libphonenumber)
    expect(formatMobile("+4915123456789")).toBe("+49 1512 3456789");
  });
});

describe("EmployeeInput", () => {
  it("requires names, contract type and a valid mobile; normalises", () => {
    const parsed = EmployeeInput.parse({
      ...base,
      email: "",
      personnelNo: "  ",
    });
    expect(parsed.mobile).toBe("+4915123456789");
    expect(parsed.email).toBeNull();
    expect(parsed.personnelNo).toBeNull();
    const issues = EmployeeInput.safeParse({ mobile: "abc" }).error?.issues.map(
      (i) => i.path.join("."),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        "firstName",
        "lastName",
        "mobile",
        "contractTypeId",
      ]),
    );
  });

  it("drops default location rows and rejects duplicate locations", () => {
    const parsed = EmployeeInput.parse({
      ...base,
      locations: [
        { locationId: L2, trained: false, preference: "neutral" },
        { locationId: L1, trained: true, preference: "neutral" },
      ],
    });
    expect(parsed.locations).toEqual([
      { locationId: L1, trained: true, preference: "neutral" },
    ]);
    expect(
      EmployeeInput.safeParse({
        ...base,
        locations: [
          { locationId: L1, trained: true, preference: "neutral" },
          { locationId: L1, trained: false, preference: "blocked" },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects an invalid e-mail and overlong notes", () => {
    expect(EmployeeInput.safeParse({ ...base, email: "nope" }).success).toBe(
      false,
    );
    expect(
      EmployeeInput.safeParse({ ...base, note: "x".repeat(2001) }).success,
    ).toBe(false);
  });
});

describe("helpers", () => {
  const e = {
    isFloater: false,
    locations: [
      { locationId: L1, trained: true, preference: "preferred" as const },
    ],
    weeklyMinutesOverride: null,
  };
  it("override hours replace the contract hours", () => {
    expect(effectiveWeeklyMinutes(e, { weeklyMinutes: 1800 })).toBe(1800);
    expect(
      effectiveWeeklyMinutes(
        { weeklyMinutesOverride: 1920 },
        { weeklyMinutes: 1800 },
      ),
    ).toBe(1920);
  });
  it("Springer are trained everywhere, preferences stay", () => {
    expect(isTrainedAt(e, L1)).toBe(true);
    expect(isTrainedAt(e, L2)).toBe(false);
    expect(isTrainedAt({ ...e, isFloater: true }, L2)).toBe(true);
    expect(preferenceAt(e, L1)).toBe("preferred");
    expect(preferenceAt(e, L2)).toBe("neutral");
  });
  it("search matches names in any order, accents and personnel no.", () => {
    const p = { firstName: "Jörg", lastName: "Weiß", personnelNo: "P-0042" };
    expect(matchesSearch(p, "jorg")).toBe(true);
    expect(matchesSearch(p, "weiss jörg")).toBe(true);
    expect(matchesSearch(p, "0042")).toBe(true);
    expect(matchesSearch(p, "anna")).toBe(false);
  });
});

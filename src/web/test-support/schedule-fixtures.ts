const T = "2026-11-08T08:00:00.000Z";
export const G21 = "01a1bb3f-0000-7000-8000-000000000031";
export const G5 = "01a1bb3f-0000-7000-8000-000000000032";
export const ANNA = "01a1bb3f-0000-7000-8000-000000000041";
export const BEN = "01a1bb3f-0000-7000-8000-000000000042";
export const CARL = "01a1bb3f-0000-7000-8000-000000000043";
export const MON = "2026-11-16";
const hours = ["mon", "tue", "wed", "thu", "fri"].map((weekday) => ({
  weekday,
  start: "07:30",
  end: "19:00",
}));
const emp = (
  id: string,
  firstName: string,
  lastName: string,
  o: object = {},
) => ({
  id,
  firstName,
  lastName,
  active: true,
  isFloater: false,
  weeklyTarget: 1800,
  allowedShiftMinutes: [],
  maxDailyMinutes: null,
  locations: [] as {
    locationId: string;
    trained: boolean;
    preference: string;
  }[],
  ...o,
});
export const asg = (o: object) => ({
  id: "01a1bb3f-0000-7000-8000-000000000071",
  locationId: G21,
  employeeId: ANNA,
  date: MON,
  start: "07:30",
  end: "19:00",
  shiftStart: "07:30",
  shiftEnd: "19:00",
  version: 1,
  updatedAt: T,
  ...o,
});
export const week = (o: object = {}) => ({
  start: MON,
  today: "2026-11-17",
  locations: [
    {
      id: G21,
      name: "Gebäude 21",
      openingHours: hours,
      staffingWindows: [
        { weekday: "mon", start: "07:30", end: "19:00", people: 2 },
        { weekday: "tue", start: "07:30", end: "19:00", people: 1 },
      ],
    },
    { id: G5, name: "Gebäude 5", openingHours: hours, staffingWindows: [] },
  ],
  employees: [
    emp(ANNA, "Anna", "Müller", {
      locations: [{ locationId: G21, trained: true, preference: "preferred" }],
    }),
    emp(BEN, "Ben", "Brandt", {
      locations: [{ locationId: G21, trained: true, preference: "neutral" }],
    }),
    emp(CARL, "Carl", "Abwesend"),
  ],
  assignments: [] as ReturnType<typeof asg>[],
  absences: [
    {
      id: "01a1bb3f-0000-7000-8000-000000000051",
      employeeId: CARL,
      kind: "vacation",
      startDate: "2026-11-16",
      endDate: "2026-11-20",
      startTime: null,
      endTime: null,
      note: null,
      version: 1,
      updatedAt: T,
    },
  ],
  rules: [
    {
      id: "01a1bb3f-0000-7000-8000-000000000061",
      employeeId: ANNA,
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      startTime: "16:00",
      endTime: null,
      version: 1,
      updatedAt: T,
    },
  ],
  ...o,
});

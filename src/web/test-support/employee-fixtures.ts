export const T = "2026-11-08T08:00:00.000Z";
export const CT30 = "01a1bb3f-0000-7000-8000-000000000001";
export const QKB = "01a1bb3f-0000-7000-8000-000000000011";
export const QEH = "01a1bb3f-0000-7000-8000-000000000012";
export const SVMS = "01a1bb3f-0000-7000-8000-000000000021";
export const G21 = "01a1bb3f-0000-7000-8000-000000000031";
export const G5 = "01a1bb3f-0000-7000-8000-000000000032";
export const ANNA = "01a1bb3f-0000-7000-8000-000000000041";
export const BEN = "01a1bb3f-0000-7000-8000-000000000042";
export const CARL = "01a1bb3f-0000-7000-8000-000000000043";

export const contractTypes = {
  items: [
    {
      id: CT30,
      name: "30-Std.-Vertrag",
      weeklyMinutes: 1800,
      typicalShiftMinutes: null,
      allowedShiftMinutes: [360, 480],
      maxDailyMinutes: 480,
      active: true,
      inUse: true,
      version: 1,
      updatedAt: T,
    },
  ],
};
export const qualifications = {
  items: [
    { id: QEH, name: "Ersthelfer", active: false, version: 2, updatedAt: T },
    { id: QKB, name: "Kundenbereich", active: true, version: 1, updatedAt: T },
  ],
};
export const systems = {
  items: [{ id: SVMS, name: "VMS", active: true, version: 1, updatedAt: T }],
};
const hours = [{ weekday: "mon", start: "08:00", end: "17:00" }];
export const locations = {
  locations: [
    {
      id: G21,
      name: "Gebäude 21",
      kind: "customer_area",
      openingHours: hours,
      active: true,
      version: 1,
      updatedAt: T,
    },
    {
      id: G5,
      name: "Gebäude 5",
      kind: "reception",
      openingHours: hours,
      active: true,
      version: 1,
      updatedAt: T,
    },
  ],
};
const emp = (o: object) => ({
  mobile: "+4915123456789",
  email: null,
  personnelNo: null,
  contractTypeId: CT30,
  weeklyMinutesOverride: null,
  isFloater: false,
  qualificationIds: [],
  systemAccessIds: [],
  locations: [],
  note: null,
  active: true,
  version: 1,
  updatedAt: T,
  ...o,
});
export const anna = emp({
  id: ANNA,
  firstName: "Anna",
  lastName: "Müller",
  personnelNo: "P-1",
  qualificationIds: [QKB],
  locations: [{ locationId: G21, trained: true, preference: "preferred" }],
});
export const ben = emp({
  id: BEN,
  firstName: "Ben",
  lastName: "Springer",
  isFloater: true,
});
export const carl = emp({
  id: CARL,
  firstName: "Carl",
  lastName: "Alt",
  active: false,
});
export const employees = { employees: [anna, ben, carl] };

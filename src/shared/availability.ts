import { z } from "zod";
import { TimeOfDay, WEEKDAYS, type Weekday } from "./locations.js";

// Abwesenheiten (dated) and recurring "nicht verfügbar" rules.
// Dates are calendar dates "YYYY-MM-DD", times local Europe/Berlin "HH:MM"
// (ADR-004 exception "Planungsdaten mit Kalendertag"). All date arithmetic
// runs in UTC on plain dates — no time zone or DST drift.

const Version = z.number().int().positive();

export const ABSENCE_KINDS = [
  "vacation",
  "absent",
  "appointment",
  "wish_off",
] as const;
export const AbsenceKind = z.enum(ABSENCE_KINDS);
export type AbsenceKind = z.infer<typeof AbsenceKind>;
export const ABSENCE_KIND_LABELS: Record<AbsenceKind, string> = {
  vacation: "Urlaub",
  absent: "Abwesend",
  appointment: "Termin / Weiterbildung",
  wish_off: "Wunsch frei",
};
/** "Wunsch frei" is soft (avoid if possible); everything else is hard. */
export const isSoft = (kind: AbsenceKind) => kind === "wish_off";

const SHORT: Record<Weekday, string> = {
  mon: "Mo",
  tue: "Di",
  wed: "Mi",
  thu: "Do",
  fri: "Fr",
  sat: "Sa",
  sun: "So",
};

// --- Dates -------------------------------------------------------------------
const toUtc = (d: string) => new Date(`${d}T00:00:00Z`);
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);

export const IsoDate = z
  .string({ error: "Bitte ein Datum angeben." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Bitte ein Datum angeben." })
  .refine((d) => !Number.isNaN(toUtc(d).getTime()) && fromUtc(toUtc(d)) === d, {
    error: "Kein gültiges Datum.",
  })
  .refine((d) => d >= "2000-01-01" && d <= "2100-12-31", {
    error: "Datum zwischen 2000 und 2100 angeben.",
  });

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}
export const daysBetween = (a: string, b: string) =>
  Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);

export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[(toUtc(date).getUTCDay() + 6) % 7] as Weekday;
}
export const mondayOf = (date: string) =>
  addDays(date, -WEEKDAYS.indexOf(weekdayOf(date)));
export const weekDays = (start: string) =>
  Array.from({ length: 7 }, (_, i) => addDays(start, i));

/** ISO 8601 week number. */
export function isoWeek(date: string): number {
  const thursday = addDays(mondayOf(date), 3);
  const yearStart = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(daysBetween(yearStart, thursday) / 7) + 1;
}

/** "2026-10-05" → "05.10.2026" (withYear) or "05.10." */
export function formatDate(date: string, withYear = true): string {
  const [y, m, d] = date.split("-");
  return withYear ? `${d}.${m}.${y}` : `${d}.${m}.`;
}

// --- Absences ----------------------------------------------------------------
const optionalTime = TimeOfDay.nullish().transform((v) => v ?? null);

const AbsenceFields = z.object({
  kind: AbsenceKind,
  startDate: IsoDate,
  endDate: IsoDate,
  startTime: optionalTime,
  endTime: optionalTime,
  note: z
    .string()
    .trim()
    .max(500, { error: "Höchstens 500 Zeichen." })
    .nullish()
    .transform((v) => (v ? v : null)),
});

type AbsenceShape = z.output<typeof AbsenceFields>;
function checkAbsence(v: AbsenceShape, ctx: z.RefinementCtx) {
  if (v.endDate < v.startDate) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "Das Ende liegt vor dem Beginn.",
    });
    return;
  }
  if (daysBetween(v.startDate, v.endDate) > 365) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "Höchstens ein Jahr am Stück.",
    });
  }
  const hasTime = v.startTime !== null || v.endTime !== null;
  if (!hasTime) return;
  if (v.startDate !== v.endDate) {
    ctx.addIssue({
      code: "custom",
      path: ["startTime"],
      message: "Uhrzeiten nur bei eintägigen Abwesenheiten.",
    });
  } else if (v.startTime === null || v.endTime === null) {
    ctx.addIssue({
      code: "custom",
      path: [v.startTime === null ? "startTime" : "endTime"],
      message: "Bitte Beginn und Ende angeben.",
    });
  } else if (v.startTime >= v.endTime) {
    ctx.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "Das Ende muss nach dem Beginn liegen.",
    });
  }
}

export const AbsenceInput = AbsenceFields.superRefine(checkAbsence);
export type AbsenceInput = z.output<typeof AbsenceInput>;
export const AbsenceUpdate = AbsenceFields.extend({
  version: Version,
}).superRefine(checkAbsence);

export const Absence = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  kind: AbsenceKind,
  startDate: z.string(),
  endDate: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  note: z.string().nullable(),
  version: Version,
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Absence = z.infer<typeof Absence>;

// --- Rules ("nicht verfügbar", recurring, always hard) ------------------------
const RuleFields = z.object({
  weekdays: z
    .array(z.enum(WEEKDAYS))
    .min(1, { error: "Bitte mindestens einen Wochentag wählen." })
    .refine((a) => new Set(a).size === a.length, {
      error: "Jeden Wochentag nur einmal.",
    })
    .transform((a) => WEEKDAYS.filter((d) => a.includes(d))),
  startTime: optionalTime,
  endTime: optionalTime,
});
function checkRule(v: z.output<typeof RuleFields>, ctx: z.RefinementCtx) {
  if (v.startTime !== null && v.endTime !== null && v.startTime >= v.endTime) {
    ctx.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "Das Ende muss nach dem Beginn liegen.",
    });
  }
}
export const RuleInput = RuleFields.superRefine(checkRule);
export type RuleInput = z.output<typeof RuleInput>;
export const RuleUpdate = RuleFields.extend({ version: Version }).superRefine(
  checkRule,
);

export const AvailabilityRule = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  weekdays: z.array(z.enum(WEEKDAYS)),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  version: Version,
  updatedAt: z.iso.datetime({ offset: true }),
});
export type AvailabilityRule = z.infer<typeof AvailabilityRule>;

export const EmployeeAvailability = z.object({
  absences: z.array(Absence),
  rules: z.array(AvailabilityRule),
});
export type EmployeeAvailability = z.infer<typeof EmployeeAvailability>;

export const WeekView = z.object({
  start: z.string(),
  employees: z.array(
    z.object({
      id: z.uuid(),
      firstName: z.string(),
      lastName: z.string(),
      personnelNo: z.string().nullable(),
    }),
  ),
  absences: z.array(Absence),
  rules: z.array(AvailabilityRule),
});
export type WeekView = z.infer<typeof WeekView>;

// --- Lookups & formatting ------------------------------------------------------
export const absencesOn = <T extends Pick<Absence, "startDate" | "endDate">>(
  absences: readonly T[],
  date: string,
) => absences.filter((a) => a.startDate <= date && date <= a.endDate);

export const rulesOn = <T extends Pick<AvailabilityRule, "weekdays">>(
  rules: readonly T[],
  date: string,
) => rules.filter((r) => r.weekdays.includes(weekdayOf(date)));

/** "05.10.–16.10.2026", "05.10.2026, 14:00–16:00", "05.10.2026" */
export function formatAbsencePeriod(
  a: Pick<Absence, "startDate" | "endDate" | "startTime" | "endTime">,
): string {
  if (a.startDate !== a.endDate) {
    const sameYear = a.startDate.slice(0, 4) === a.endDate.slice(0, 4);
    return `${formatDate(a.startDate, !sameYear)}–${formatDate(a.endDate)}`;
  }
  return a.startTime && a.endTime
    ? `${formatDate(a.startDate)}, ${a.startTime}–${a.endTime}`
    : formatDate(a.startDate);
}

export function formatAbsence(
  a: Pick<Absence, "kind" | "startDate" | "endDate" | "startTime" | "endTime">,
): string {
  return `${ABSENCE_KIND_LABELS[a.kind]} · ${formatAbsencePeriod(a)}`;
}

/** Time part of a rule: "ganztägig", "ab 16:00", "vor 10:00", "10:00–12:00". */
export function formatRuleTime(
  r: Pick<AvailabilityRule, "startTime" | "endTime">,
): string {
  if (r.startTime && r.endTime) return `${r.startTime}–${r.endTime}`;
  if (r.startTime) return `ab ${r.startTime}`;
  if (r.endTime) return `vor ${r.endTime}`;
  return "ganztägig";
}

/** "Mo–Fr ab 16:00", "Di ganztägig", "täglich vor 10:00", "Mo, Mi, Fr 10:00–12:00" */
export function formatRule(
  r: Pick<AvailabilityRule, "weekdays" | "startTime" | "endTime">,
): string {
  const idx = WEEKDAYS.map((d) => r.weekdays.includes(d));
  let days: string;
  if (idx.every(Boolean)) days = "täglich";
  else {
    const parts: string[] = [];
    for (let i = 0; i < 7; i++) {
      if (!idx[i]) continue;
      let j = i;
      while (j + 1 < 7 && idx[j + 1]) j++;
      const a = SHORT[WEEKDAYS[i] as Weekday];
      const b = SHORT[WEEKDAYS[j] as Weekday];
      parts.push(j - i >= 2 ? `${a}–${b}` : j === i ? a : `${a}, ${b}`);
      i = j;
    }
    days = parts.join(", ");
  }
  return `${days} ${formatRuleTime(r)}`;
}

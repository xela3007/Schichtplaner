import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { z } from "zod";
import { WeeklyMinutes } from "./catalogs.js";

const Version = z.number().int().positive();

export const PREFERENCES = ["preferred", "neutral", "blocked"] as const;
export const Preference = z.enum(PREFERENCES);
export type Preference = z.infer<typeof Preference>;
export const PREFERENCE_LABELS: Record<Preference, string> = {
  preferred: "bevorzugt",
  neutral: "neutral",
  blocked: "gesperrt",
};

export const EmployeeLocation = z.object({
  locationId: z.uuid(),
  trained: z.boolean(),
  preference: Preference,
});
export type EmployeeLocation = z.infer<typeof EmployeeLocation>;

/** Any valid number, national input defaults to Germany; stored as E.164. */
export function normalizeMobile(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), "DE");
  return parsed?.isValid() ? parsed.number : null;
}

/** "+4915123456789" → "+49 151 23456789" for display. */
export function formatMobile(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, { error: message })
    .nullish()
    .transform((v) => (v ? v : null));

const uniqueIds = z
  .array(z.uuid())
  .max(100)
  .default([])
  .refine((a) => new Set(a).size === a.length, { error: "Doppelte Auswahl." })
  .transform((a) => [...a].sort());

export const EmployeeInput = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, { error: "Bitte einen Vornamen angeben." })
    .max(100, { error: "Höchstens 100 Zeichen." }),
  lastName: z
    .string()
    .trim()
    .min(1, { error: "Bitte einen Nachnamen angeben." })
    .max(100, { error: "Höchstens 100 Zeichen." }),
  mobile: z
    .string({ error: "Bitte eine Handynummer angeben." })
    .trim()
    .min(1, { error: "Bitte eine Handynummer angeben." })
    .transform((v, ctx) => {
      const n = normalizeMobile(v);
      if (!n) {
        ctx.addIssue({ code: "custom", message: "Keine gültige Handynummer." });
        return z.NEVER;
      }
      return n;
    }),
  email: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null))
    .pipe(z.email({ error: "Keine gültige E-Mail-Adresse." }).nullable()),
  personnelNo: optionalText(30, "Höchstens 30 Zeichen."),
  contractTypeId: z.uuid({ error: "Bitte einen Vertragstyp wählen." }),
  weeklyMinutesOverride: WeeklyMinutes.nullable().default(null),
  isFloater: z.boolean().default(false),
  qualificationIds: uniqueIds,
  systemAccessIds: uniqueIds,
  locations: z
    .array(EmployeeLocation)
    .max(200)
    .default([])
    .refine((a) => new Set(a.map((l) => l.locationId)).size === a.length, {
      error: "Jeder Standort nur einmal.",
    })
    // "not trained + neutral" is the default — not stored.
    .transform((a) =>
      a
        .filter((l) => l.trained || l.preference !== "neutral")
        .sort((x, y) => x.locationId.localeCompare(y.locationId)),
    ),
  note: optionalText(2000, "Höchstens 2000 Zeichen."),
});
export type EmployeeInput = z.output<typeof EmployeeInput>;
export type EmployeeFormInput = z.input<typeof EmployeeInput>;

export const EmployeeUpdate = EmployeeInput.extend({ version: Version });

export const Employee = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  mobile: z.string(),
  email: z.string().nullable(),
  personnelNo: z.string().nullable(),
  contractTypeId: z.uuid(),
  weeklyMinutesOverride: z.number().int().nullable(),
  isFloater: z.boolean(),
  qualificationIds: z.array(z.uuid()),
  systemAccessIds: z.array(z.uuid()),
  locations: z.array(EmployeeLocation),
  note: z.string().nullable(),
  active: z.boolean(),
  version: Version,
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Employee = z.infer<typeof Employee>;
export const EmployeeList = z.object({ employees: z.array(Employee) });

/** Override hours replace the contract's weekly hours; everything else stays from the contract. */
export function effectiveWeeklyMinutes(
  employee: Pick<Employee, "weeklyMinutesOverride">,
  contractType: { weeklyMinutes: number } | undefined,
): number | null {
  return employee.weeklyMinutesOverride ?? contractType?.weeklyMinutes ?? null;
}

/** Springer count as trained everywhere; blocks and qualifications still apply elsewhere. */
export function isTrainedAt(
  employee: Pick<Employee, "isFloater" | "locations">,
  locationId: string,
): boolean {
  return (
    employee.isFloater ||
    employee.locations.some((l) => l.locationId === locationId && l.trained)
  );
}

export function preferenceAt(
  employee: Pick<Employee, "locations">,
  locationId: string,
): Preference {
  return (
    employee.locations.find((l) => l.locationId === locationId)?.preference ??
    "neutral"
  );
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .trim();

/** Name (first, last, both orders) and personnel number, case- and accent-insensitive. */
export function matchesSearch(
  employee: Pick<Employee, "firstName" | "lastName" | "personnelNo">,
  term: string,
): boolean {
  const t = fold(term);
  if (!t) return true;
  const hay = [
    `${employee.firstName} ${employee.lastName}`,
    `${employee.lastName} ${employee.firstName}`,
    `${employee.lastName}, ${employee.firstName}`,
    employee.personnelNo ?? "",
  ].map(fold);
  return hay.some((h) => h.includes(t));
}

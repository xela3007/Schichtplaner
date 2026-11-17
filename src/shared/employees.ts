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
  /** only meaningful in location mode "only_selected" (dc6c6578); missing = false */
  released: z.boolean().optional(),
});
export type EmployeeLocation = z.infer<typeof EmployeeLocation>;

// --- Where someone may work (dc6c6578) ---------------------------------------------
export const LOCATION_MODES = ["all_except_blocked", "only_selected"] as const;
export const LocationMode = z.enum(LOCATION_MODES);
export type LocationMode = z.infer<typeof LocationMode>;
export const LOCATION_MODE_LABELS: Record<LocationMode, string> = {
  all_except_blocked: "an allen Standorten außer gesperrten",
  only_selected: "nur an ausgewählten Standorten",
};

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

const EmployeeFields = {
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
  // optional since dc6c6578; empty → null, otherwise validated and stored as E.164
  mobile: z
    .string()
    .trim()
    .nullish()
    .transform((v, ctx) => {
      if (!v) return null;
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
  locationMode: LocationMode.default("all_except_blocked"),
  locations: z
    .array(EmployeeLocation)
    .max(200)
    .default([])
    .refine((a) => new Set(a.map((l) => l.locationId)).size === a.length, {
      error: "Jeder Standort nur einmal.",
    })
    // "not trained + neutral + not released" is the default — not stored.
    .transform((a) =>
      a
        .filter((l) => l.trained || l.preference !== "neutral" || l.released)
        .map((l) => ({ ...l, released: l.released ?? false }))
        .sort((x, y) => x.locationId.localeCompare(y.locationId)),
    ),
  note: optionalText(2000, "Höchstens 2000 Zeichen."),
};

const modeFits = (
  v: { locationMode: LocationMode; locations: EmployeeLocation[] },
  ctx: z.RefinementCtx,
) => {
  if (
    v.locationMode === "all_except_blocked" &&
    v.locations.some((l) => l.released)
  )
    ctx.addIssue({
      code: "custom",
      path: ["locations"],
      message: "Freigaben gibt es nur bei „nur ausgewählte Standorte“.",
    });
  if (
    v.locationMode === "only_selected" &&
    v.locations.some((l) => l.preference === "blocked")
  )
    ctx.addIssue({
      code: "custom",
      path: ["locations"],
      message: "Bei „nur ausgewählte Standorte“ gibt es keine Sperren.",
    });
};

export const EmployeeInput = z.object(EmployeeFields).superRefine(modeFits);
export type EmployeeInput = z.output<typeof EmployeeInput>;
export type EmployeeFormInput = z.input<typeof EmployeeInput>;

export const EmployeeUpdate = z
  .object({ ...EmployeeFields, version: Version })
  .superRefine(modeFits);

export const Employee = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  mobile: z.string().nullable(),
  email: z.string().nullable(),
  personnelNo: z.string().nullable(),
  contractTypeId: z.uuid(),
  weeklyMinutesOverride: z.number().int().nullable(),
  isFloater: z.boolean(),
  qualificationIds: z.array(z.uuid()),
  systemAccessIds: z.array(z.uuid()),
  locationMode: LocationMode.optional(),
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

/**
 * May not be planned at the location: a block in "all_except_blocked", or no
 * release in "only_selected" — also for locations created later (dc6c6578).
 */
export function isBlockedAt(
  employee: Pick<Employee, "locations"> & { locationMode?: LocationMode },
  locationId: string,
): boolean {
  const row = employee.locations.find((l) => l.locationId === locationId);
  return employee.locationMode === "only_selected"
    ? !row?.released
    : row?.preference === "blocked";
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

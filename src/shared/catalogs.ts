import { z } from "zod";

// Auswahllisten for employee profiles: contract types, qualifications and
// system accesses. Entries are never deleted, only deactivated.

const Version = z.number().int().positive();

export const CatalogName = z
  .string()
  .trim()
  .min(1, { error: "Bitte einen Namen angeben." })
  .max(100, { error: "Höchstens 100 Zeichen." });

export const CatalogInput = z.object({ name: CatalogName });
export type CatalogInput = z.infer<typeof CatalogInput>;
export const CatalogUpdate = CatalogInput.extend({ version: Version });

export const CatalogEntry = z.object({
  id: z.uuid(),
  name: z.string(),
  active: z.boolean(),
  version: Version,
  updatedAt: z.iso.datetime({ offset: true }),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;
export const CatalogList = z.object({ items: z.array(CatalogEntry) });

export const CATALOG_KINDS = ["qualifications", "system-accesses"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];
export const CATALOG_LABELS: Record<
  CatalogKind,
  { title: string; singular: string }
> = {
  qualifications: { title: "Qualifikationen", singular: "Qualifikation" },
  "system-accesses": { title: "Systemzugänge", singular: "Systemzugang" },
};

// --- Contract types (all durations in minutes) -----------------------------
const ShiftMinutes = z
  .number({ error: "Bitte eine Zahl angeben." })
  .int()
  .min(15, { error: "Mindestens 0,25 Std." })
  .max(960, { error: "Höchstens 16 Std." });

export const WeeklyMinutes = z
  .number({ error: "Bitte eine Zahl angeben." })
  .int()
  .min(60, { error: "Mindestens 1 Std." })
  .max(3600, { error: "Höchstens 60 Std." });

const ContractTypeFields = z.object({
  name: CatalogName,
  weeklyMinutes: WeeklyMinutes,
  typicalShiftMinutes: ShiftMinutes.nullable().default(null),
  allowedShiftMinutes: z
    .array(ShiftMinutes)
    .max(12)
    .default([])
    .refine((a) => new Set(a).size === a.length, {
      error: "Jede Schichtlänge nur einmal.",
    })
    .transform((a) => [...a].sort((x, y) => x - y)),
  maxDailyMinutes: ShiftMinutes.nullable().default(null),
});

type HoursShape = {
  typicalShiftMinutes: number | null;
  allowedShiftMinutes: number[];
  maxDailyMinutes: number | null;
};

/** Consistency rules between the duration fields (reported on the offending field). */
function checkHours(v: HoursShape, ctx: z.RefinementCtx) {
  const max = v.maxDailyMinutes;
  if (max !== null) {
    if (v.allowedShiftMinutes.some((m) => m > max)) {
      ctx.addIssue({
        code: "custom",
        path: ["allowedShiftMinutes"],
        message:
          "Erlaubte Schichtlängen dürfen die max. Stunden pro Tag nicht überschreiten.",
      });
    }
    if (v.typicalShiftMinutes !== null && v.typicalShiftMinutes > max) {
      ctx.addIssue({
        code: "custom",
        path: ["typicalShiftMinutes"],
        message:
          "Die übliche Schichtlänge darf die max. Stunden pro Tag nicht überschreiten.",
      });
    }
  }
  if (
    v.typicalShiftMinutes !== null &&
    v.allowedShiftMinutes.length > 0 &&
    !v.allowedShiftMinutes.includes(v.typicalShiftMinutes)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["typicalShiftMinutes"],
      message: "Die übliche Schichtlänge muss eine der erlaubten sein.",
    });
  }
}

export const ContractTypeInput = ContractTypeFields.superRefine(checkHours);
export type ContractTypeInput = z.infer<typeof ContractTypeInput>;
export const ContractTypeUpdate = ContractTypeFields.extend({
  version: Version,
}).superRefine(checkHours);

export const ContractType = z.object({
  id: z.uuid(),
  name: z.string(),
  weeklyMinutes: z.number().int(),
  typicalShiftMinutes: z.number().int().nullable(),
  allowedShiftMinutes: z.array(z.number().int()),
  maxDailyMinutes: z.number().int().nullable(),
  active: z.boolean(),
  inUse: z.boolean(),
  version: Version,
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ContractType = z.infer<typeof ContractType>;
export const ContractTypeList = z.object({ items: z.array(ContractType) });

/** True when any duration differs — these are locked while the type is in use. */
export function hoursChanged(
  a: HoursShape & { weeklyMinutes: number },
  b: HoursShape & { weeklyMinutes: number },
) {
  return (
    a.weeklyMinutes !== b.weeklyMinutes ||
    a.typicalShiftMinutes !== b.typicalShiftMinutes ||
    a.maxDailyMinutes !== b.maxDailyMinutes ||
    a.allowedShiftMinutes.join(",") !== b.allowedShiftMinutes.join(",")
  );
}

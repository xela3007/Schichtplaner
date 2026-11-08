import { z } from "zod";

export const WEEKDAYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;
export const Weekday = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof Weekday>;

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Montag",
  tue: "Dienstag",
  wed: "Mittwoch",
  thu: "Donnerstag",
  fri: "Freitag",
  sat: "Samstag",
  sun: "Sonntag",
};

/** Time of day, local time Europe/Berlin (ADR-004 amendment). */
export const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  error: "Bitte eine Uhrzeit im Format HH:MM angeben.",
});

export const MAX_RANGES_PER_DAY = 6;

export const TimeRange = z
  .object({ weekday: Weekday, start: TimeOfDay, end: TimeOfDay })
  .refine((r) => r.start < r.end, {
    error:
      "Das Ende muss nach dem Beginn liegen (Zeiträume über Mitternacht sind nicht möglich).",
    path: ["end"],
  });
export type TimeRange = z.infer<typeof TimeRange>;

export const OpeningHours = z.array(TimeRange).superRefine((ranges, ctx) => {
  for (const day of WEEKDAYS) {
    const indexed = ranges
      .map((r, index) => ({ r, index }))
      .filter(({ r }) => r.weekday === day)
      .sort((a, b) => a.r.start.localeCompare(b.r.start));
    if (indexed.length > MAX_RANGES_PER_DAY) {
      ctx.addIssue({
        code: "custom",
        message: `Höchstens ${MAX_RANGES_PER_DAY} Zeiträume pro Tag.`,
        path: [indexed[MAX_RANGES_PER_DAY]?.index ?? 0, "start"],
      });
    }
    for (let i = 1; i < indexed.length; i++) {
      const prev = indexed[i - 1];
      const cur = indexed[i];
      // Touching ranges (12:00–12:00) are fine; overlapping ones are not.
      if (prev && cur && cur.r.start < prev.r.end) {
        ctx.addIssue({
          code: "custom",
          message: `Überschneidet sich mit ${prev.r.start}–${prev.r.end}.`,
          path: [cur.index, "start"],
        });
      }
    }
  }
});
export type OpeningHours = z.infer<typeof OpeningHours>;

export const LOCATION_KINDS = [
  "customer_area",
  "reception",
  "training_center",
  "other",
] as const;
export const LocationKind = z.enum(LOCATION_KINDS, {
  error: "Bitte eine Art auswählen.",
});
export type LocationKind = z.infer<typeof LocationKind>;

export const LOCATION_KIND_LABELS: Record<LocationKind, string> = {
  customer_area: "Kundenbereich",
  reception: "Empfang",
  training_center: "Schulungszentrum",
  other: "Sonstiges",
};

export const LocationInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: "Bitte einen Namen angeben." })
    .max(80, { error: "Höchstens 80 Zeichen." }),
  kind: LocationKind,
  openingHours: OpeningHours,
});
export type LocationInput = z.infer<typeof LocationInput>;

const Version = z.number().int().positive();

export const LocationUpdate = LocationInput.extend({ version: Version });
export type LocationUpdate = z.infer<typeof LocationUpdate>;

export const VersionOnly = z.object({ version: Version });

export const Location = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: LocationKind,
  openingHours: OpeningHours,
  active: z.boolean(),
  version: Version,
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Location = z.infer<typeof Location>;

export const LocationList = z.object({ locations: z.array(Location) });

export const AuditAction = z.enum([
  "created",
  "updated",
  "deactivated",
  "reactivated",
]);
export type AuditAction = z.infer<typeof AuditAction>;

export const AuditEntry = z.object({
  id: z.uuid(),
  action: AuditAction,
  actorEmail: z.string().nullable(),
  occurredAt: z.iso.datetime({ offset: true }),
  changes: z.record(
    z.string(),
    z.object({ from: z.unknown(), to: z.unknown() }),
  ),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const LocationHistory = z.object({ entries: z.array(AuditEntry) });

export const VersionConflict = z.object({
  error: z.literal("version_conflict"),
  current: Location,
});

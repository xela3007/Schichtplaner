import { z } from "zod";
import {
  type OpeningHours,
  TimeOfDay,
  WEEKDAYS,
  Weekday,
} from "./locations.js";

export const MAX_PEOPLE = 20;
export const MAX_WINDOWS_PER_DAY = 30;

/** One staffing window: how many people are needed on a weekday between start and end (local time, ADR-004). */
export const StaffingWindow = z
  .object({
    weekday: Weekday,
    start: TimeOfDay,
    end: TimeOfDay,
    people: z
      .number({ error: "Bitte eine Personenzahl angeben." })
      .int({ error: "Bitte eine ganze Zahl angeben." })
      .min(1, { error: "Mindestens 1 Person." })
      .max(MAX_PEOPLE, { error: `Höchstens ${MAX_PEOPLE} Personen.` }),
  })
  .refine((w) => w.start < w.end, {
    error: "Das Ende muss nach dem Beginn liegen.",
    path: ["end"],
  });
export type StaffingWindow = z.infer<typeof StaffingWindow>;

export const StaffingWindows = z
  .array(StaffingWindow)
  .superRefine((windows, ctx) => {
    for (const day of WEEKDAYS) {
      const indices = windows
        .map((w, i) => (w.weekday === day ? i : -1))
        .filter((i) => i >= 0);
      if (indices.length > MAX_WINDOWS_PER_DAY) {
        ctx.addIssue({
          code: "custom",
          message: `Höchstens ${MAX_WINDOWS_PER_DAY} Zeitfenster pro Tag.`,
          path: [indices[MAX_WINDOWS_PER_DAY] ?? 0, "start"],
        });
      }
    }
  });

export const StaffingUpdate = z.object({
  windows: StaffingWindows,
  version: z.number().int().min(0),
});
export type StaffingUpdate = z.infer<typeof StaffingUpdate>;

export const Staffing = z.object({
  windows: StaffingWindows,
  version: z.number().int().min(0),
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type Staffing = z.infer<typeof Staffing>;

/** Indices of windows that don't lie fully inside ONE opening range of the same weekday. */
export function windowsOutsideOpeningHours(
  windows: readonly Pick<StaffingWindow, "weekday" | "start" | "end">[],
  openingHours: OpeningHours,
): number[] {
  return windows
    .map((w, i) => {
      const inside = openingHours.some(
        (o) => o.weekday === w.weekday && o.start <= w.start && w.end <= o.end,
      );
      return inside ? -1 : i;
    })
    .filter((i) => i >= 0);
}

export type CoverageStatus = "covered" | "gap" | "outside";
export type CoverageSegment = {
  start: string;
  end: string;
  required: number;
  status: CoverageStatus;
};
export type Coverage = Record<Weekday, CoverageSegment[]>;

/**
 * Gesamtübersicht: splits each weekday at every boundary of opening ranges and
 * staffing windows, adds overlapping windows up, marks opening time without
 * demand as "gap" and demand outside the opening hours as "outside".
 */
export function computeCoverage(
  openingHours: OpeningHours,
  windows: readonly Pick<
    StaffingWindow,
    "weekday" | "start" | "end" | "people"
  >[],
): Coverage {
  const result = {} as Coverage;
  for (const day of WEEKDAYS) {
    const open = openingHours.filter((o) => o.weekday === day);
    const dayWindows = windows.filter((w) => w.weekday === day);
    const bounds = [
      ...new Set([...open, ...dayWindows].flatMap((r) => [r.start, r.end])),
    ].sort();
    const segments: CoverageSegment[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const start = bounds[i] as string;
      const end = bounds[i + 1] as string;
      const isOpen = open.some((o) => o.start <= start && end <= o.end);
      const required = dayWindows
        .filter((w) => w.start <= start && end <= w.end)
        .reduce((sum, w) => sum + w.people, 0);
      if (!isOpen && required === 0) continue;
      const status: CoverageStatus = !isOpen
        ? "outside"
        : required === 0
          ? "gap"
          : "covered";
      const prev = segments.at(-1);
      if (
        prev &&
        prev.end === start &&
        prev.status === status &&
        prev.required === required
      ) {
        prev.end = end;
      } else {
        segments.push({ start, end, required, status });
      }
    }
    result[day] = segments;
  }
  return result;
}

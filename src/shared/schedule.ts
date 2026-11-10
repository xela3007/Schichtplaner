import { z } from "zod";
import {
  ABSENCE_KIND_LABELS,
  Absence,
  AvailabilityRule,
  absencesOn,
  addDays,
  formatRule,
  IsoDate,
  isSoft,
  mondayOf,
  rulesOn,
  weekdayOf,
} from "./availability.js";
import { EmployeeLocation, isTrainedAt, preferenceAt } from "./employees.js";
import { TimeOfDay, TimeRange } from "./locations.js";

// Schichtplan (Teil 1): assignments of employees to shifts, plus the pure
// rule engine shared by the UI (hints, ranking) and the API (enforcing blocks).
// Dates "YYYY-MM-DD", times local "HH:MM" (ADR-004 "Planungsdaten mit Kalendertag").

const Version = z.number().int().positive();

export const toMin = (t: string) =>
  Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMin = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const overlaps = (a0: number, a1: number, b0: number, b1: number) =>
  a0 < b1 && b0 < a1;

// --- Schemas -------------------------------------------------------------------
const AssignFields = z.object({
  locationId: z.uuid(),
  employeeId: z.uuid(),
  date: IsoDate,
  start: TimeOfDay,
  end: TimeOfDay,
  shiftStart: TimeOfDay,
  shiftEnd: TimeOfDay,
});
export const AssignInput = AssignFields.refine((v) => v.start < v.end, {
  path: ["end"],
  error: "Das Ende muss nach dem Beginn liegen.",
});
export type AssignInput = z.infer<typeof AssignInput>;

export const Assignment = AssignFields.extend({
  id: z.uuid(),
  version: Version,
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Assignment = z.infer<typeof Assignment>;

const StaffWindow = z.object({
  weekday: z.string(),
  start: z.string(),
  end: z.string(),
  people: z.number().int(),
});

export const ScheduleLocation = z.object({
  id: z.uuid(),
  name: z.string(),
  openingHours: z.array(TimeRange),
  staffingWindows: z.array(StaffWindow),
});
export type ScheduleLocation = z.infer<typeof ScheduleLocation>;

export const ScheduleEmployee = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  active: z.boolean(),
  isFloater: z.boolean(),
  weeklyTarget: z.number().int(),
  allowedShiftMinutes: z.array(z.number().int()),
  maxDailyMinutes: z.number().int().nullable(),
  locations: z.array(EmployeeLocation),
});
export type ScheduleEmployee = z.infer<typeof ScheduleEmployee>;

// --- Day overrides (Teil 2) ---------------------------------------------------------
export const OVERRIDE_KINDS = ["added", "changed", "cancelled"] as const;
export const ShiftOverride = z.object({
  id: z.uuid(),
  locationId: z.uuid(),
  date: z.string(),
  kind: z.enum(OVERRIDE_KINDS),
  baseStart: z.string().nullable(),
  baseEnd: z.string().nullable(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  people: z.number().int().nullable(),
  version: Version,
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ShiftOverride = z.infer<typeof ShiftOverride>;

const People = z
  .number({ error: "Bitte eine Personenzahl angeben." })
  .int({ error: "Bitte eine ganze Zahl angeben." })
  .min(1, { error: "Mindestens 1 Person." })
  .max(20, { error: "Höchstens 20 Personen." });
const Times = { start: TimeOfDay, end: TimeOfDay, people: People };
const Base = { baseStart: TimeOfDay, baseEnd: TimeOfDay };
const Where = {
  locationId: z.uuid(),
  date: IsoDate,
  removeAssignments: z.boolean().optional(),
};
const startBeforeEnd = (v: object) => {
  const t = v as { start?: string; end?: string };
  return !t.start || !t.end || t.start < t.end;
};

export const OverrideInput = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("added"), ...Where, ...Times }),
    z.object({ kind: z.literal("changed"), ...Where, ...Base, ...Times }),
    z.object({ kind: z.literal("cancelled"), ...Where, ...Base }),
  ])
  .refine(startBeforeEnd, {
    path: ["end"],
    error: "Das Ende muss nach dem Beginn liegen.",
  });
export type OverrideInput = z.infer<typeof OverrideInput>;

export const OverrideTimes = z.object(Times).refine(startBeforeEnd, {
  path: ["end"],
  error: "Das Ende muss nach dem Beginn liegen.",
});
export type OverrideTimes = z.infer<typeof OverrideTimes>;

export const OverrideUpdate = z.union([
  z
    .object({
      ...Times,
      version: Version,
      removeAssignments: z.boolean().optional(),
    })
    .refine(startBeforeEnd, {
      path: ["end"],
      error: "Das Ende muss nach dem Beginn liegen.",
    }),
  z.object({
    cancelled: z.literal(true),
    version: Version,
    removeAssignments: z.boolean().optional(),
  }),
]);
export type OverrideUpdate = z.infer<typeof OverrideUpdate>;

export const ScheduleWeek = z.object({
  start: z.string(),
  today: z.string(),
  locations: z.array(ScheduleLocation),
  employees: z.array(ScheduleEmployee),
  assignments: z.array(Assignment),
  absences: z.array(Absence),
  rules: z.array(AvailabilityRule),
  overrides: z.array(ShiftOverride).default([]),
});
export type ScheduleWeek = z.infer<typeof ScheduleWeek>;

export const BLOCK_CODES = [
  "past",
  "absence",
  "rule",
  "location_blocked",
  "overlap",
] as const;
export const WARNING_CODES = [
  "wish_off",
  "not_trained",
  "shift_length",
  "max_daily",
  "over_weekly",
] as const;
export type Reason = {
  code: (typeof BLOCK_CODES)[number] | (typeof WARNING_CODES)[number];
  message: string;
};

// --- Hours ---------------------------------------------------------------------
/** Arbeitszeitgesetz: > 6 h → 30 min, > 9 h → 45 min — on the day's summed gross time. */
export function breakMinutes(dayGross: number): number {
  if (dayGross > 9 * 60) return 45;
  if (dayGross > 6 * 60) return 30;
  return 0;
}
export const grossMinutes = (a: Pick<Assignment, "start" | "end">) =>
  toMin(a.end) - toMin(a.start);

/** Net minutes of a set of assignments, breaks applied per day. */
export function netMinutes(
  assignments: readonly Pick<Assignment, "date" | "start" | "end">[],
): number {
  const byDay = new Map<string, number>();
  for (const a of assignments)
    byDay.set(a.date, (byDay.get(a.date) ?? 0) + grossMinutes(a));
  let total = 0;
  for (const gross of byDay.values()) total += gross - breakMinutes(gross);
  return total;
}

/** "7,5 Std." */
export const hoursText = (minutes: number) =>
  `${(minutes / 60).toLocaleString("de-DE", { maximumFractionDigits: 2 })} Std.`;

export function weekPlan(
  employee: Pick<ScheduleEmployee, "id" | "weeklyTarget">,
  assignments: readonly Assignment[],
) {
  const plannedNet = netMinutes(
    assignments.filter((a) => a.employeeId === employee.id),
  );
  return {
    plannedNet,
    target: employee.weeklyTarget,
    free: employee.weeklyTarget - plannedNet,
  };
}

// --- Rule engine -----------------------------------------------------------------
export type RuleContext = {
  today: string;
  employee: ScheduleEmployee;
  locationId: string;
  /** names for messages */
  locationNames: Record<string, string>;
  absences: readonly Absence[];
  rules: readonly AvailabilityRule[];
  /** all assignments of the week (any employee); the candidate itself must not be included */
  assignments: readonly Assignment[];
};
export type Candidate = { date: string; start: string; end: string };

export function evaluateCandidate(
  ctx: RuleContext,
  c: Candidate,
): { blocks: Reason[]; warnings: Reason[] } {
  const blocks: Reason[] = [];
  const warnings: Reason[] = [];
  const s = toMin(c.start);
  const e = toMin(c.end);
  const emp = ctx.employee;
  const mine = ctx.assignments.filter((a) => a.employeeId === emp.id);

  if (c.date < ctx.today)
    blocks.push({ code: "past", message: "Tag liegt in der Vergangenheit" });

  for (const a of absencesOn(
    ctx.absences.filter((x) => x.employeeId === emp.id),
    c.date,
  )) {
    const hit =
      !a.startTime ||
      !a.endTime ||
      overlaps(s, e, toMin(a.startTime), toMin(a.endTime));
    if (!hit) continue;
    const time = a.startTime ? ` ${a.startTime}–${a.endTime}` : "";
    if (isSoft(a.kind))
      warnings.push({ code: "wish_off", message: `Wunsch frei${time}` });
    else
      blocks.push({
        code: "absence",
        message: `abwesend: ${ABSENCE_KIND_LABELS[a.kind]}${time}`,
      });
  }

  for (const r of rulesOn(
    ctx.rules.filter((x) => x.employeeId === emp.id),
    c.date,
  )) {
    const r0 = r.startTime ? toMin(r.startTime) : 0;
    const r1 = r.endTime ? toMin(r.endTime) : 24 * 60;
    if (overlaps(s, e, r0, r1))
      blocks.push({
        code: "rule",
        message: `nicht verfügbar ${formatRule(r)}`,
      });
  }

  if (preferenceAt(emp, ctx.locationId) === "blocked") {
    blocks.push({ code: "location_blocked", message: "am Standort gesperrt" });
  }

  for (const a of mine.filter((x) => x.date === c.date)) {
    if (overlaps(s, e, toMin(a.start), toMin(a.end))) {
      blocks.push({
        code: "overlap",
        message: `zeitgleich in ${ctx.locationNames[a.locationId] ?? "anderem Standort"} ${a.start}–${a.end}`,
      });
    }
  }

  if (!isTrainedAt(emp, ctx.locationId))
    warnings.push({ code: "not_trained", message: "nicht eingearbeitet" });

  const gross = e - s;
  if (
    emp.allowedShiftMinutes.length > 0 &&
    !emp.allowedShiftMinutes.includes(gross)
  ) {
    warnings.push({
      code: "shift_length",
      message: `Schichtlänge ${hoursText(gross)} nicht im Vertrag (${emp.allowedShiftMinutes.map((m) => hoursText(m).replace(" Std.", "")).join(" / ")} Std.)`,
    });
  }
  const dayGross =
    mine
      .filter((a) => a.date === c.date)
      .reduce((sum, a) => sum + grossMinutes(a), 0) + gross;
  if (emp.maxDailyMinutes !== null && dayGross > emp.maxDailyMinutes) {
    warnings.push({
      code: "max_daily",
      message: `über max. ${hoursText(emp.maxDailyMinutes)} pro Tag (${hoursText(dayGross)})`,
    });
  }
  const weekStart = mondayOf(c.date);
  const inWeek = mine.filter(
    (a) => a.date >= weekStart && a.date <= addDays(weekStart, 6),
  );
  const net = netMinutes([
    ...inWeek,
    { date: c.date, start: c.start, end: c.end },
  ]);
  if (net > emp.weeklyTarget) {
    warnings.push({
      code: "over_weekly",
      message: `Wochenstunden über Soll (${hoursText(net)} / ${hoursText(emp.weeklyTarget)})`,
    });
  }
  return { blocks, warnings };
}

// --- Effective shifts of a day (standard demand + day overrides) ------------------
export type EffectiveShift = {
  start: string;
  end: string;
  people: number;
  source: "standard" | "added" | "changed";
  base?: { start: string; end: string };
  override?: ShiftOverride;
};
export type CancelledShift = {
  base: { start: string; end: string };
  override: ShiftOverride;
  baseExists: boolean;
};

export function effectiveShifts(
  location:
    | Pick<ScheduleLocation, "id" | "staffingWindows">
    | Pick<ScheduleLocation, "staffingWindows">,
  date: string,
  overrides: readonly ShiftOverride[] = [],
): { shifts: EffectiveShift[]; cancelled: CancelledShift[] } {
  const day = weekdayOf(date);
  const locId = "id" in location ? location.id : undefined;
  const mine = overrides.filter(
    (o) => o.date === date && (locId === undefined || o.locationId === locId),
  );
  const byBase = (start: string, end: string) =>
    mine.find(
      (o) => o.kind !== "added" && o.baseStart === start && o.baseEnd === end,
    );
  const windows = location.staffingWindows.filter((w) => w.weekday === day);
  const shifts: EffectiveShift[] = [];
  // Overrides whose standard shift was edited later in the demand keep owning
  // that slot (PO: "Abweichung gilt weiter, Änderung wirkt nur auf Tage ohne
  // Abweichung"). Demand windows have no identity, so a new standard window
  // that shares its start or end with such an orphaned base counts as the same
  // shift and is suppressed on that day.
  const orphans = mine.filter(
    (o) =>
      o.kind !== "added" &&
      !windows.some((w) => w.start === o.baseStart && w.end === o.baseEnd),
  );
  const ownedByOrphan = (w: { start: string; end: string }) =>
    orphans.some((o) => o.baseStart === w.start || o.baseEnd === w.end);
  for (const w of windows) {
    const o = byBase(w.start, w.end);
    if (!o && ownedByOrphan(w)) continue;
    if (!o)
      shifts.push({
        start: w.start,
        end: w.end,
        people: w.people,
        source: "standard",
      });
    else if (o.kind === "changed")
      shifts.push({
        start: o.start as string,
        end: o.end as string,
        people: o.people as number,
        source: "changed",
        base: { start: w.start, end: w.end },
        override: o,
      });
  }
  // a changed override whose base vanished from the demand still applies (PO)
  for (const o of mine.filter((x) => x.kind === "changed")) {
    if (!windows.some((w) => w.start === o.baseStart && w.end === o.baseEnd)) {
      shifts.push({
        start: o.start as string,
        end: o.end as string,
        people: o.people as number,
        source: "changed",
        base: { start: o.baseStart as string, end: o.baseEnd as string },
        override: o,
      });
    }
  }
  for (const o of mine.filter((x) => x.kind === "added")) {
    shifts.push({
      start: o.start as string,
      end: o.end as string,
      people: o.people as number,
      source: "added",
      override: o,
    });
  }
  const cancelled = mine
    .filter((o) => o.kind === "cancelled")
    .map((o) => ({
      base: { start: o.baseStart as string, end: o.baseEnd as string },
      override: o,
      baseExists: windows.some(
        (w) => w.start === o.baseStart && w.end === o.baseEnd,
      ),
    }));
  shifts.sort(
    (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end),
  );
  return { shifts, cancelled };
}

/** Assignment time is fine inside the opening hours, or inside the effective shift it is anchored to. */
export function assignmentWindowOk(
  location: Pick<ScheduleLocation, "openingHours" | "staffingWindows"> & {
    id?: string;
  },
  overrides: readonly ShiftOverride[],
  a: Pick<Assignment, "date" | "start" | "end" | "shiftStart" | "shiftEnd">,
): boolean {
  if (insideOpening(location, a.date, a.start, a.end)) return true;
  const shift = effectiveShifts(location, a.date, overrides).shifts.find(
    (s) => s.start === a.shiftStart && s.end === a.shiftEnd,
  );
  return !!shift && shift.start <= a.start && a.end <= shift.end;
}

/**
 * Assignments anchored to a shift whose times change: those that still fit
 * the new times are kept (re-anchored), the rest must be removed after a
 * confirmation. `to = null` = the shift disappears (cancel / delete).
 */
export function affectedAssignments(
  assignments: readonly Assignment[],
  locationId: string,
  date: string,
  anchor: { start: string; end: string },
  to: { start: string; end: string } | null,
): { keep: Assignment[]; remove: Assignment[] } {
  const anchored = assignments.filter(
    (a) =>
      a.locationId === locationId &&
      a.date === date &&
      a.shiftStart === anchor.start &&
      a.shiftEnd === anchor.end,
  );
  if (!to) return { keep: [], remove: anchored };
  const fits = (a: Assignment) => to.start <= a.start && a.end <= to.end;
  return {
    keep: anchored.filter(fits),
    remove: anchored.filter((a) => !fits(a)),
  };
}

// --- Coverage ----------------------------------------------------------------------
export type CoverageStatus = "covered" | "gap" | "over";
export type CoverageSegment = {
  start: string;
  end: string;
  required: number;
  assigned: number;
  status: CoverageStatus;
};

/** Minute-exact coverage of one location and day: summed demand vs assigned people. */
export function coverageFor(
  location: Pick<ScheduleLocation, "openingHours" | "staffingWindows"> & {
    id?: string;
  },
  date: string,
  assignments: readonly Pick<Assignment, "date" | "start" | "end">[],
  overrides: readonly ShiftOverride[] = [],
): CoverageSegment[] {
  const windows = effectiveShifts(location, date, overrides).shifts;
  const asg = assignments.filter((a) => a.date === date);
  const bounds = [
    ...new Set(
      [...windows, ...asg].flatMap((r) => [toMin(r.start), toMin(r.end)]),
    ),
  ].sort((a, b) => a - b);
  const out: CoverageSegment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const s = bounds[i] as number;
    const e = bounds[i + 1] as number;
    const required = windows
      .filter((w) => toMin(w.start) <= s && e <= toMin(w.end))
      .reduce((n, w) => n + w.people, 0);
    const assigned = asg.filter(
      (a) => toMin(a.start) <= s && e <= toMin(a.end),
    ).length;
    if (required === 0 && assigned === 0) continue;
    const status: CoverageStatus =
      assigned < required ? "gap" : assigned > required ? "over" : "covered";
    const prev = out.at(-1);
    if (
      prev &&
      toMin(prev.end) === s &&
      prev.required === required &&
      prev.assigned === assigned
    )
      prev.end = fromMin(e);
    else
      out.push({
        start: fromMin(s),
        end: fromMin(e),
        required,
        assigned,
        status,
      });
  }
  return out;
}

/** "gedeckt" | "Lücke 08:00–10:00 (1 fehlt)" … */
export function coverageText(segments: readonly CoverageSegment[]): {
  status: CoverageStatus | "none";
  lines: string[];
} {
  if (segments.length === 0) return { status: "none", lines: [] };
  const gaps = segments.filter((s) => s.status === "gap");
  const over = segments.filter((s) => s.status === "over");
  if (gaps.length === 0 && over.length === 0)
    return { status: "covered", lines: ["gedeckt"] };
  const lines = [
    ...gaps.map(
      (g) => `Lücke ${g.start}–${g.end} (${g.required - g.assigned} fehlt)`,
    ),
    ...over.map(
      (o) => `überbesetzt ${o.start}–${o.end} (+${o.assigned - o.required})`,
    ),
  ];
  return { status: gaps.length > 0 ? "gap" : "over", lines };
}

/** "passt nicht mehr": the shift no longer exists that day, or the time left the opening hours. */
export function isOutdated(
  a: Pick<Assignment, "date" | "start" | "end" | "shiftStart" | "shiftEnd">,
  location: Pick<ScheduleLocation, "openingHours" | "staffingWindows"> & {
    id?: string;
  },
  overrides: readonly ShiftOverride[] = [],
): boolean {
  const shiftExists = effectiveShifts(location, a.date, overrides).shifts.some(
    (s) => s.start === a.shiftStart && s.end === a.shiftEnd,
  );
  return !shiftExists || !assignmentWindowOk(location, overrides, a);
}

export function insideOpening(
  location: Pick<ScheduleLocation, "openingHours">,
  date: string,
  start: string,
  end: string,
): boolean {
  const day = weekdayOf(date);
  return location.openingHours.some(
    (o) => o.weekday === day && o.start <= start && end <= o.end,
  );
}

// --- Ranking -----------------------------------------------------------------------
export type RankedCandidate = {
  employee: ScheduleEmployee;
  blocks: Reason[];
  warnings: Reason[];
  free: number;
};

/** Active employees, best fit first: not blocked, trained, preferred, most free hours, name. */
export function rankCandidates(
  week: Pick<
    ScheduleWeek,
    "today" | "employees" | "assignments" | "absences" | "rules" | "locations"
  >,
  locationId: string,
  c: Candidate,
): RankedCandidate[] {
  const names = Object.fromEntries(week.locations.map((l) => [l.id, l.name]));
  return week.employees
    .filter((e) => e.active)
    .map((employee) => {
      const { blocks, warnings } = evaluateCandidate(
        {
          today: week.today,
          employee,
          locationId,
          locationNames: names,
          absences: week.absences,
          rules: week.rules,
          assignments: week.assignments,
        },
        c,
      );
      return {
        employee,
        blocks,
        warnings,
        free: weekPlan(employee, week.assignments).free,
      };
    })
    .sort((a, b) => {
      const score = (r: RankedCandidate) => [
        r.blocks.length > 0 ? 1 : 0,
        isTrainedAt(r.employee, locationId) ? 0 : 1,
        preferenceAt(r.employee, locationId) === "preferred" ? 0 : 1,
      ];
      const [a0, a1, a2] = score(a);
      const [b0, b1, b2] = score(b);
      return (
        (a0 as number) - (b0 as number) ||
        (a1 as number) - (b1 as number) ||
        (a2 as number) - (b2 as number) ||
        b.free - a.free ||
        a.employee.lastName.localeCompare(b.employee.lastName, "de") ||
        a.employee.firstName.localeCompare(b.employee.firstName, "de")
      );
    });
}

/** Today in Europe/Berlin as YYYY-MM-DD (server and browser). */
export const todayInBerlin = (now: Date = new Date()) =>
  now.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

export const DeactivateBody = z.object({
  version: Version,
  /** Remove assignments from tomorrow on and deactivate in one step. */
  removeAssignments: z.boolean().optional(),
});

// --- Teil 3: copy a template week into up to 4 target weeks -----------------------
const isMonday = (d: string) => weekdayOf(d) === "mon";
export const MAX_COPY_TARGETS = 4;

export const CopyInput = z
  .object({
    sourceStart: IsoDate.refine(isMonday, "Die Woche muss am Montag beginnen."),
    targetStarts: z
      .array(IsoDate.refine(isMonday, "Die Woche muss am Montag beginnen."))
      .min(1, "Bitte mindestens eine Zielwoche wählen.")
      .max(MAX_COPY_TARGETS, `Höchstens ${MAX_COPY_TARGETS} Zielwochen.`),
    locationIds: z
      .array(z.uuid())
      .min(1, "Bitte mindestens einen Standort wählen."),
  })
  .refine((v) => new Set(v.targetStarts).size === v.targetStarts.length, {
    path: ["targetStarts"],
    error: "Jede Zielwoche nur einmal.",
  })
  .refine((v) => !v.targetStarts.includes(v.sourceStart), {
    path: ["targetStarts"],
    error: "Die Quellwoche kann nicht Zielwoche sein.",
  });
export type CopyInput = z.infer<typeof CopyInput>;

export const COPY_SKIP_REASONS = [
  "absence",
  "rule",
  "location_blocked",
  "overlap",
  "inactive",
  "no_shift",
  "full",
] as const;
export const CopySkip = z.object({
  employeeId: z.uuid(),
  employeeName: z.string(),
  locationId: z.uuid(),
  locationName: z.string(),
  date: IsoDate,
  start: TimeOfDay,
  end: TimeOfDay,
  reason: z.enum(COPY_SKIP_REASONS),
  message: z.string(),
});
export type CopySkip = z.infer<typeof CopySkip>;

export const ScheduleCopy = z.object({
  id: z.uuid(),
  sourceStart: IsoDate,
  targetStarts: z.array(IsoDate),
  locationIds: z.array(z.uuid()),
  copied: z.number().int(),
  remaining: z.number().int(),
  actorEmail: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  undoneAt: z.iso.datetime({ offset: true }).nullable(),
  version: Version,
});
export type ScheduleCopy = z.infer<typeof ScheduleCopy>;

export const CopyResult = z.object({
  copy: ScheduleCopy.nullable(),
  copied: z.number().int(),
  alreadyPresent: z.number().int(),
  skipped: z.array(CopySkip),
});
export type CopyResult = z.infer<typeof CopyResult>;

export type CopyPlan = {
  create: AssignInput[];
  alreadyPresent: number;
  skipped: CopySkip[];
};

/**
 * Pure plan of a week copy (story 4456a836). Walks the source assignments of
 * the chosen locations by date/start and maps each to the same weekday of every
 * target week. Hard blocks, missing and full shifts are skipped and listed;
 * soft warnings never stop it. Planned assignments count for the next checks.
 */
export function planCopy(p: {
  source: ScheduleWeek;
  targets: readonly ScheduleWeek[];
  locationIds: readonly string[];
  today: string;
}): CopyPlan {
  const create: AssignInput[] = [];
  const skipped: CopySkip[] = [];
  let alreadyPresent = 0;
  const sourceAsg = p.source.assignments
    .filter((a) => p.locationIds.includes(a.locationId))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.start.localeCompare(b.start) ||
        a.end.localeCompare(b.end),
    );
  const sourceName = (id: string) => {
    const e = p.source.employees.find((x) => x.id === id);
    return e ? `${e.lastName}, ${e.firstName}` : "unbekannt";
  };
  for (const target of p.targets) {
    // working copy: planned assignments become visible to the following checks
    const planned: Assignment[] = [...target.assignments];
    const locationNames = Object.fromEntries(
      target.locations.map((l) => [l.id, l.name]),
    );
    for (const src of sourceAsg) {
      const offset = Math.round(
        (Date.parse(src.date) - Date.parse(p.source.start)) / 86_400_000,
      );
      const date = addDays(target.start, offset);
      if (date < p.today) continue;
      const cand = {
        locationId: src.locationId,
        employeeId: src.employeeId,
        date,
        start: src.start,
        end: src.end,
        shiftStart: src.shiftStart,
        shiftEnd: src.shiftEnd,
      };
      const location = target.locations.find((l) => l.id === src.locationId);
      const skip = (reason: CopySkip["reason"], message: string) =>
        skipped.push({
          employeeId: src.employeeId,
          employeeName: sourceName(src.employeeId),
          locationId: src.locationId,
          locationName:
            location?.name ??
            p.source.locations.find((l) => l.id === src.locationId)?.name ??
            "unbekannt",
          date,
          start: src.start,
          end: src.end,
          reason,
          message,
        });
      if (
        planned.some(
          (a) =>
            a.employeeId === cand.employeeId &&
            a.locationId === cand.locationId &&
            a.date === date &&
            a.start === cand.start &&
            a.end === cand.end,
        )
      ) {
        alreadyPresent++;
        continue;
      }
      const employee = target.employees.find((e) => e.id === src.employeeId);
      if (!employee?.active) {
        skip("inactive", "nicht mehr aktiv");
        continue;
      }
      if (!location) {
        skip("no_shift", "Standort nicht aktiv");
        continue;
      }
      const shift = effectiveShifts(
        location,
        date,
        target.overrides,
      ).shifts.find(
        (s) => s.start === cand.shiftStart && s.end === cand.shiftEnd,
      );
      if (!shift || !assignmentWindowOk(location, target.overrides, cand)) {
        skip("no_shift", "Schicht gibt es an dem Tag nicht");
        continue;
      }
      const anchored = planned.filter(
        (a) =>
          a.locationId === location.id &&
          a.date === date &&
          a.shiftStart === shift.start &&
          a.shiftEnd === shift.end,
      ).length;
      if (anchored >= shift.people) {
        skip("full", `Schicht schon voll (${anchored} / ${shift.people})`);
        continue;
      }
      const { blocks } = evaluateCandidate(
        {
          today: p.today,
          employee,
          locationId: location.id,
          locationNames,
          absences: target.absences,
          rules: target.rules,
          assignments: planned,
        },
        cand,
      );
      const block = blocks.find((b) => b.code !== "past");
      if (block) {
        skip(block.code as CopySkip["reason"], block.message);
        continue;
      }
      create.push(cand);
      planned.push({
        ...cand,
        id: `00000000-0000-7000-8000-${String(create.length).padStart(12, "0")}`,
        version: 1,
        updatedAt: new Date(0).toISOString(),
      });
    }
  }
  return { create, alreadyPresent, skipped };
}

import {
  type Assignment,
  effectiveShifts,
  type ScheduleLocation,
  type ShiftOverride,
  toMin,
} from "#shared/schedule.js";

export type Lane = { lane: number; lanes: number };

/**
 * Outlook-style lanes: overlapping items form a cluster; every item of a
 * cluster gets a lane and the cluster's lane count, so its bars share the width.
 */
export function layoutLanes<T extends { start: string; end: string }>(
  items: readonly T[],
): Map<T, Lane> {
  const sorted = [...items].sort(
    (a, b) => toMin(a.start) - toMin(b.start) || toMin(b.end) - toMin(a.end),
  );
  const out = new Map<T, Lane>();
  let cluster: { item: T; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = laneEnds.length;
    for (const c of cluster) out.set(c.item, { lane: c.lane, lanes });
    cluster = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    const s = toMin(item.start);
    const e = toMin(item.end);
    if (s >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(e);
    } else laneEnds[lane] = e;
    cluster.push({ item, lane });
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return out;
}

/** Whole hours [from, to) covering opening hours, effective shifts and assignments of the days. */
export function timeRange(
  location: ScheduleLocation,
  days: readonly string[],
  assignments: readonly Pick<Assignment, "date" | "start" | "end">[],
  overrides: readonly ShiftOverride[] = [],
): { from: number; to: number } {
  const times: { start: string; end: string }[] = [...location.openingHours];
  for (const d of days) {
    const { shifts, cancelled } = effectiveShifts(location, d, overrides);
    times.push(...shifts, ...cancelled.map((c) => c.base));
  }
  times.push(...assignments.filter((a) => days.includes(a.date)));
  if (times.length === 0) return { from: 7, to: 19 };
  const from = Math.floor(Math.min(...times.map((t) => toMin(t.start))) / 60);
  const to = Math.ceil(Math.max(...times.map((t) => toMin(t.end))) / 60);
  return { from, to: Math.max(to, from + 1) };
}

// Dinexis tints (ADR-011) — colour only helps tell people apart; the name is always written.
const PALETTE = [
  { bg: "var(--brand-100)", border: "var(--brand-700)" },
  { bg: "var(--magenta-100)", border: "var(--magenta-700)" },
  { bg: "var(--info-100)", border: "var(--info)" },
  { bg: "var(--success-100)", border: "var(--success)" },
  { bg: "var(--warning-100)", border: "var(--warning)" },
  { bg: "var(--paper-3)", border: "var(--ink-2)" },
] as const;

/** Stable colour per employee across the week. */
export function employeeColor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length] as (typeof PALETTE)[number];
}

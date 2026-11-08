import {
  LOCATION_KIND_LABELS,
  type Location,
  type LocationKind,
  type OpeningHours,
  WEEKDAYS,
  type Weekday,
} from "#shared/locations.js";

export const SHORT_DAY: Record<Weekday, string> = {
  mon: "Mo",
  tue: "Di",
  wed: "Mi",
  thu: "Do",
  fri: "Fr",
  sat: "Sa",
  sun: "So",
};

export function kindLabel(kind: LocationKind | string): string {
  return LOCATION_KIND_LABELS[kind as LocationKind] ?? kind;
}

/** "08:00–12:00, 13:00–17:00" or "geschlossen" for one weekday. */
export function dayText(hours: OpeningHours, day: Weekday): string {
  const ranges = hours
    .filter((r) => r.weekday === day)
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((r) => `${r.start}–${r.end}`);
  return ranges.length ? ranges.join(", ") : "geschlossen";
}

/** Compact week: consecutive days with identical hours are merged ("Mo–Fr 07:30–19:00"). */
export function compactWeek(hours: OpeningHours): string[] {
  if (hours.length === 0) return ["geschlossen"];
  const lines: string[] = [];
  let i = 0;
  while (i < WEEKDAYS.length) {
    const day = WEEKDAYS[i] as Weekday;
    const text = dayText(hours, day);
    let j = i;
    while (
      j + 1 < WEEKDAYS.length &&
      dayText(hours, WEEKDAYS[j + 1] as Weekday) === text
    )
      j++;
    if (text !== "geschlossen") {
      const last = WEEKDAYS[j] as Weekday;
      lines.push(
        `${SHORT_DAY[day]}${j > i ? `–${SHORT_DAY[last]}` : ""} ${text}`,
      );
    }
    i = j + 1;
  }
  return lines;
}

export function sortedByName(list: Location[]): Location[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

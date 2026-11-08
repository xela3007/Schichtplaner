import type { OpeningHours } from "#shared/locations.js";
import { WEEKDAY_LABELS, WEEKDAYS } from "#shared/locations.js";
import { computeCoverage, type StaffingWindow } from "#shared/staffing.js";
import { Pill } from "@/components/ui/pill";
import { Status } from "@/components/ui/status";

const people = (n: number) => `${n} ${n === 1 ? "Person" : "Personen"}`;

/**
 * Gesamtübersicht per weekday: how many people are needed when. Overlapping
 * windows are added up; open time without demand and demand outside the
 * opening hours are flagged. Readable on a phone (rows wrap, no table).
 */
export function StaffingOverview({
  openingHours,
  windows,
}: {
  openingHours: OpeningHours;
  windows: readonly StaffingWindow[];
}) {
  const coverage = computeCoverage(openingHours, windows);
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr] sm:gap-x-6">
      {WEEKDAYS.map((day) => (
        <div key={day} className="contents">
          <dt className="font-medium sm:font-normal sm:text-muted-foreground">
            {WEEKDAY_LABELS[day]}
          </dt>
          <dd className="grid gap-1 sm:mb-1">
            {coverage[day].length === 0 && (
              <span className="text-muted-foreground">geschlossen</span>
            )}
            {coverage[day].map((s) => (
              <span
                key={`${s.start}-${s.status}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-1"
              >
                <span className="tabular-nums">
                  {s.start}–{s.end}
                  {s.status !== "gap" && ` · ${people(s.required)}`}
                </span>
                {s.status === "gap" && (
                  <Status tone="warn">geöffnet, kein Bedarf hinterlegt</Status>
                )}
                {s.status === "outside" && (
                  <Pill>außerhalb der Öffnungszeiten</Pill>
                )}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

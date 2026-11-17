import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatDate, mondayOf, weekdayOf } from "#shared/availability.js";
import { effectiveShifts, ScheduleWeek } from "#shared/schedule.js";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { apiFetch } from "@/lib/api";
import { SHORT_DAY } from "@/lib/locations";
import { ResetCancelled, ShiftEditor } from "../schedule/ShiftEditor";

/**
 * Exception editing for one date of one location (story 16bb5be3). This is the
 * editing UI that lived in the week view's day column (2b06b608), moved here.
 */
export function ExceptionDay({
  locationId,
  date,
}: {
  locationId: string;
  date: string;
}) {
  const start = mondayOf(date);
  const [editing, setEditing] = useState<string | null>(null);
  const week = useQuery({
    queryKey: ["schedule-week", start],
    queryFn: () =>
      apiFetch(`/schedule/week?start=${start}`, {
        schema: ScheduleWeek,
        auth: true,
      }),
  });
  const dayLabel = `${SHORT_DAY[weekdayOf(date)]} ${formatDate(date, false)}`;

  if (week.isPending)
    return <p className="text-muted-foreground">Tag wird geladen …</p>;
  if (week.isError)
    return (
      <p className="text-destructive">Der Tag konnte nicht geladen werden.</p>
    );
  const location = week.data.locations.find((l) => l.id === locationId);
  if (!location)
    return (
      <p className="text-muted-foreground">
        Inaktive Standorte haben keine Ausnahmen.
      </p>
    );
  const { shifts, cancelled } = effectiveShifts(
    location,
    date,
    week.data.overrides,
  );

  return (
    <section aria-label={`Schichten am ${dayLabel}`} className="grid gap-2">
      <h3 className="font-medium">{dayLabel}</h3>
      {shifts.length === 0 && cancelled.length === 0 && (
        <p className="text-muted-foreground">kein Bedarf an diesem Tag</p>
      )}
      {shifts.map((w) => {
        const key = `${w.start}-${w.end}`;
        return (
          <div key={key} className="grid gap-1">
            <span className="flex flex-wrap items-center gap-1.5 tabular-nums">
              {w.start}–{w.end} · Soll {w.people}
              {w.source === "added" && <Pill variant="brand">zusätzlich</Pill>}
              {w.source === "changed" && w.base && (
                <Pill variant="brand">
                  angepasst (normal {w.base.start}–{w.base.end})
                </Pill>
              )}
              {editing !== key && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5"
                  onClick={() => setEditing(key)}
                  aria-label={`${dayLabel} ${w.start}–${w.end} anpassen`}
                >
                  anpassen
                </Button>
              )}
            </span>
            {editing === key && (
              <ShiftEditor
                location={location}
                date={date}
                shift={w}
                onDone={() => setEditing(null)}
              />
            )}
          </div>
        );
      })}
      {cancelled.map((c) => (
        <div
          key={c.override.id}
          className="flex flex-wrap items-center gap-1.5"
        >
          <span className="tabular-nums text-ink-2 line-through">
            {c.base.start}–{c.base.end}
          </span>
          <Pill>entfällt</Pill>
          <ResetCancelled
            override={c.override}
            label={`${dayLabel} ${c.base.start}–${c.base.end}`}
          />
        </div>
      ))}
      {editing === "new" ? (
        <ShiftEditor
          location={location}
          date={date}
          onDone={() => setEditing(null)}
        />
      ) : (
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing("new")}
            aria-label={`${dayLabel} zusätzliche Schicht hinzufügen`}
          >
            + zusätzliche Schicht
          </Button>
        </div>
      )}
    </section>
  );
}

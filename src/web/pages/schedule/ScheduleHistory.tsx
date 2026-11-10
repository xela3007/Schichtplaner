import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { formatDate, weekdayOf } from "#shared/availability.js";
import { AuditAction, type Weekday } from "#shared/locations.js";
import type { ScheduleWeek } from "#shared/schedule.js";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/locations";

const SHORT: Record<Weekday, string> = {
  mon: "Mo",
  tue: "Di",
  wed: "Mi",
  thu: "Do",
  fri: "Fr",
  sat: "Sa",
  sun: "So",
};
const REASONS: Record<string, string> = {
  employee_deactivated: "Mitarbeiter deaktiviert",
  location_deactivated: "Standort deaktiviert",
  shift_changed: "Schicht geändert",
  week_copied: "Woche übernommen",
  copy_undone: "Übernahme zurückgenommen",
};
type Snap = {
  date: string;
  employeeId?: string;
  start: string | null;
  end: string | null;
  kind?: string;
  baseStart?: string | null;
  baseEnd?: string | null;
  people?: number | null;
};
const SHIFT_LABELS: Record<string, string> = {
  shift_added: "Schicht hinzugefügt",
  shift_changed: "Schicht angepasst",
  shift_cancelled: "Schicht entfällt",
  shift_reset: "Schicht zurückgesetzt",
  shift_deleted: "Schicht gelöscht",
};
/** "Mo 16.11. 07:30–15:00 · 2 Personen (normal 07:30–19:00)" */
function describeShift(s: Snap): string {
  const day = `${SHORT[weekdayOf(s.date)]} ${formatDate(s.date, false)}`;
  const base = s.baseStart ? `${s.baseStart}–${s.baseEnd}` : null;
  if (s.kind === "cancelled") return `${day} ${base}`;
  const people = s.people
    ? ` · ${s.people} ${s.people === 1 ? "Person" : "Personen"}`
    : "";
  return `${day} ${s.start}–${s.end}${people}${base ? ` (normal ${base})` : ""}`;
}

// Tolerant on `changes` so one unexpected entry can't hide the whole history.
const ScheduleHistoryResponse = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      action: AuditAction,
      actorEmail: z.string().nullable(),
      occurredAt: z.string(),
      changes: z.record(z.string(), z.unknown()),
      employeeName: z.string().nullable().optional(),
    }),
  ),
});
const reasonOf = (v: unknown) =>
  typeof v === "string"
    ? v
    : typeof v === "object" && v !== null
      ? ((v as { to?: string }).to ?? undefined)
      : undefined;

/** Collapsible "Änderungsverlauf" of one location for the shown week. */
export function ScheduleHistory({
  locationId,
  week,
}: {
  locationId: string;
  week: ScheduleWeek;
}) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["schedule-history", locationId, week.start],
    queryFn: () =>
      apiFetch(
        `/schedule/history?locationId=${locationId}&start=${week.start}`,
        { schema: ScheduleHistoryResponse, auth: true },
      ),
    enabled: open,
  });
  const name = (id: string) => {
    const e = week.employees.find((x) => x.id === id);
    return e ? `${e.firstName} ${e.lastName}` : "unbekannt";
  };
  return (
    <div className="grid gap-2 text-sm">
      <div>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Änderungsverlauf ausblenden" : "Änderungsverlauf anzeigen"}
        </Button>
      </div>
      {open && query.isPending && (
        <p className="text-muted-foreground">Verlauf wird geladen …</p>
      )}
      {open && query.isError && (
        <p className="text-destructive">Verlauf konnte nicht geladen werden.</p>
      )}
      {open && query.data?.entries.length === 0 && (
        <p className="text-muted-foreground">
          Keine Änderungen in dieser Woche.
        </p>
      )}
      {open && (
        <ol className="grid gap-1.5">
          {query.data?.entries.map((entry) => {
            const change = entry.changes.entry as
              | { from: Snap | null; to: Snap | null }
              | undefined;
            const snap = change?.to ?? change?.from;
            const reason = reasonOf(entry.changes.reason);
            return (
              <li key={entry.id}>
                <span className="font-medium">
                  {SHIFT_LABELS[entry.action] ??
                    (entry.action === "assigned" ? "eingeteilt" : "ausgeteilt")}
                </span>
                {reason && ` (${REASONS[reason] ?? reason})`}
                {snap &&
                  (SHIFT_LABELS[entry.action]
                    ? `: ${describeShift(snap)}`
                    : `: ${entry.employeeName ?? name(snap.employeeId ?? "")}, ${SHORT[weekdayOf(snap.date)]} ${formatDate(snap.date, false)} ${snap.start}–${snap.end}`)}
                <span className="text-muted-foreground">
                  {" "}
                  – von {entry.actorEmail ?? "unbekannt"} am{" "}
                  {formatDateTime(entry.occurredAt)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

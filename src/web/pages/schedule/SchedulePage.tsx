import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  addDays,
  formatDate,
  IsoDate,
  isoWeek,
  mondayOf,
  weekDays,
  weekdayOf,
} from "#shared/availability.js";
import type { Weekday } from "#shared/locations.js";
import {
  type Assignment,
  coverageFor,
  coverageText,
  evaluateCandidate,
  hoursText,
  isOutdated,
  type ScheduleLocation,
  ScheduleWeek,
  weekPlan,
} from "#shared/schedule.js";
import { PageShell } from "@/components/PageShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Status } from "@/components/ui/status";
import { ApiError, apiFetch } from "@/lib/api";
import { useCan } from "@/lib/permissions";
import { todayInBerlin } from "@/lib/time";
import { cn } from "@/lib/utils";
import { AssignDialog, type Shift } from "./AssignDialog";
import { ScheduleHistory } from "./ScheduleHistory";

const SHORT: Record<Weekday, string> = {
  mon: "Mo",
  tue: "Di",
  wed: "Mi",
  thu: "Do",
  fri: "Fr",
  sat: "Sa",
  sun: "So",
};

/** PC (≥ md) may edit; phones only read (story a238fced). jsdom has no matchMedia → desktop. */
function useIsDesktop() {
  const query = "(min-width: 768px)";
  const get = () =>
    typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : true;
  const [desktop, setDesktop] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return desktop;
}

function AssignmentRow({
  a,
  week,
  location,
  editable,
}: {
  a: Assignment;
  week: ScheduleWeek;
  location: ScheduleLocation;
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const employee = week.employees.find((e) => e.id === a.employeeId);
  const partial = a.start !== a.shiftStart || a.end !== a.shiftEnd;
  // conflicts that appeared after the assignment (absence, rule, block, overlap)
  const conflicts = employee
    ? evaluateCandidate(
        {
          today: "0000-01-01",
          employee,
          locationId: a.locationId,
          locationNames: Object.fromEntries(
            week.locations.map((l) => [l.id, l.name]),
          ),
          absences: week.absences,
          rules: week.rules,
          assignments: week.assignments.filter((x) => x.id !== a.id),
        },
        a,
      ).blocks
    : [];
  async function remove() {
    setError(null);
    try {
      await apiFetch(`/schedule/assignments/${a.id}?version=${a.version}`, {
        method: "DELETE",
        auth: true,
      });
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "version_conflict"
          ? "Wurde inzwischen geändert."
          : "Austeilen fehlgeschlagen.",
      );
    }
    setConfirm(false);
    void queryClient.invalidateQueries({ queryKey: ["schedule-week"] });
    void queryClient.invalidateQueries({ queryKey: ["schedule-history"] });
  }
  const name = employee
    ? `${employee.lastName}, ${employee.firstName}`
    : "unbekannt";
  return (
    <li className="grid gap-1">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className={cn(employee && !employee.active && "line-through")}>
          {name}
        </span>
        {partial && (
          <span className="text-caption tabular-nums text-muted-foreground">
            {a.start}–{a.end}
          </span>
        )}
        {employee && !employee.active && <Pill>ausgeschieden</Pill>}
        {isOutdated(a, location) && (
          <Pill className="border-dashed">passt nicht mehr</Pill>
        )}
        {conflicts.map((c) => (
          <Pill key={c.message} variant="accent">
            Konflikt: {c.message}
          </Pill>
        ))}
        {editable && !confirm && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5"
            onClick={() => setConfirm(true)}
            aria-label={`${name} austeilen`}
          >
            ✕
          </Button>
        )}
      </span>
      {confirm && (
        <span className="flex flex-wrap items-center gap-1.5 text-caption">
          Austeilen?
          <Button
            size="sm"
            variant="destructive"
            className="h-6 px-2"
            onClick={remove}
          >
            Ja
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2"
            onClick={() => setConfirm(false)}
          >
            Nein
          </Button>
        </span>
      )}
      {error && <span className="text-caption text-destructive">{error}</span>}
    </li>
  );
}

function DayCell({
  location,
  date,
  week,
  editableWeek,
  onAssign,
}: {
  location: ScheduleLocation;
  date: string;
  week: ScheduleWeek;
  editableWeek: boolean;
  onAssign: (shift: Shift) => void;
}) {
  const day = weekdayOf(date);
  const past = date < week.today;
  const editable = editableWeek && !past;
  const open = location.openingHours.some((o) => o.weekday === day);
  const windows = location.staffingWindows
    .filter((w) => w.weekday === day)
    .sort((a, b) => a.start.localeCompare(b.start));
  const here = week.assignments.filter(
    (a) => a.locationId === location.id && a.date === date,
  );
  const inShift = (w: { start: string; end: string }) =>
    here.filter((a) => a.shiftStart === w.start && a.shiftEnd === w.end);
  const orphans = here.filter(
    (a) =>
      !windows.some((w) => w.start === a.shiftStart && w.end === a.shiftEnd),
  );
  const cov = coverageText(coverageFor(location, date, here));
  return (
    <section
      aria-label={`${SHORT[day]} ${formatDate(date, false)}`}
      className={cn(
        "grid content-start gap-2 rounded-md border p-2 text-sm",
        past && "bg-paper-2",
        date === week.today && "border-brand-700",
      )}
    >
      <h3 className="flex flex-wrap items-baseline justify-between gap-1 font-medium">
        <span>
          {SHORT[day]} {formatDate(date, false)}
        </span>
        {date === week.today && (
          <span className="text-caption text-brand-700">heute</span>
        )}
        {past && (
          <span className="text-caption text-muted-foreground">
            abgeschlossen
          </span>
        )}
      </h3>
      {windows.length === 0 && here.length === 0 && (
        <p className="text-muted-foreground">
          {open ? "kein Bedarf" : "geschlossen"}
        </p>
      )}
      {windows.map((w) => (
        <div
          key={`${w.start}-${w.end}`}
          className="grid gap-1 border-t pt-1.5 first-of-type:border-0 first-of-type:pt-0"
        >
          <span className="text-caption tabular-nums text-ink-2">
            {w.start}–{w.end} · Soll {w.people}
          </span>
          <ul className="grid gap-1">
            {inShift(w).map((a) => (
              <AssignmentRow
                key={a.id}
                a={a}
                week={week}
                location={location}
                editable={editable}
              />
            ))}
          </ul>
          {editable && (
            <div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2"
                onClick={() =>
                  onAssign({ location, date, start: w.start, end: w.end })
                }
                aria-label={`${SHORT[day]} ${formatDate(date, false)} ${w.start}–${w.end} einteilen`}
              >
                + einteilen
              </Button>
            </div>
          )}
        </div>
      ))}
      {orphans.length > 0 && (
        <div className="grid gap-1 border-t pt-1.5">
          <span className="text-caption text-ink-2">Weitere Einteilungen</span>
          <ul className="grid gap-1">
            {orphans.map((a) => (
              <AssignmentRow
                key={a.id}
                a={a}
                week={week}
                location={location}
                editable={editable}
              />
            ))}
          </ul>
        </div>
      )}
      {cov.status !== "none" && (
        <div className="grid gap-0.5 border-t pt-1.5">
          {cov.lines.map((line) => (
            <Status
              key={line}
              tone={
                cov.status === "covered"
                  ? "ok"
                  : cov.status === "gap"
                    ? "error"
                    : "warn"
              }
              className="text-caption"
            >
              {line}
            </Status>
          ))}
        </div>
      )}
    </section>
  );
}

function HoursTable({ week }: { week: ScheduleWeek }) {
  const rows = week.employees
    .filter((e) => e.active)
    .map((e) => ({ e, ...weekPlan(e, week.assignments) }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stunden dieser Woche</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Keine aktiven Mitarbeiter.
          </p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">
              Geplante Stunden (nach Pausenabzug) gegen Soll je Mitarbeiter
            </caption>
            <thead>
              <tr className="text-left">
                <th scope="col" className="border-b p-2 font-medium">
                  Mitarbeiter
                </th>
                <th scope="col" className="border-b p-2 font-medium">
                  geplant (netto)
                </th>
                <th scope="col" className="border-b p-2 font-medium">
                  Soll
                </th>
                <th scope="col" className="border-b p-2 font-medium">
                  Stand
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, plannedNet, target }) => {
                const diff = plannedNet - target;
                return (
                  <tr key={e.id}>
                    <th
                      scope="row"
                      className="border-b p-2 text-left font-normal"
                    >
                      {e.lastName}, {e.firstName}
                    </th>
                    <td className="border-b p-2 tabular-nums">
                      {hoursText(plannedNet)}
                    </td>
                    <td className="border-b p-2 tabular-nums">
                      {hoursText(target)}
                    </td>
                    <td className="border-b p-2">
                      {diff > 0 ? (
                        <Pill variant="accent">
                          überplant +{hoursText(diff)}
                        </Pill>
                      ) : diff < 0 ? (
                        <Pill>unterplant −{hoursText(-diff)}</Pill>
                      ) : (
                        <Pill variant="brand">passt</Pill>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

/** /schichtplan — weekly plan per location (story a238fced). */
export function SchedulePage() {
  const canView = useCan("schedule.manage");
  const desktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const requested = IsoDate.safeParse(params.get("woche"));
  const today = todayInBerlin();
  const start = mondayOf(requested.success ? requested.data : today);
  const days = weekDays(start);
  const [shift, setShift] = useState<Shift | null>(null);

  const query = useQuery({
    queryKey: ["schedule-week", start],
    queryFn: () =>
      apiFetch(`/schedule/week?start=${start}`, {
        schema: ScheduleWeek,
        auth: true,
      }),
    enabled: canView,
  });

  if (!canView) {
    return (
      <PageShell>
        <Alert variant="destructive">
          <AlertDescription>
            Dir fehlt das Recht, den Schichtplan zu pflegen.
          </AlertDescription>
        </Alert>
      </PageShell>
    );
  }

  const go = (date: string) => setParams({ woche: date });
  const thisWeek = mondayOf(today);
  const jumps = Array.from({ length: 5 }, (_, i) => addDays(thisWeek, 7 * i));
  const week = query.data;

  return (
    <PageShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-h3 font-bold">Schichtplan</h1>
          <p className="text-muted-foreground">
            KW {isoWeek(start)} · {formatDate(start, false)}–
            {formatDate(addDays(start, 6))}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => go(addDays(start, -7))}
          >
            ← Vorwoche
          </Button>
          <Button variant="ghost" size="sm" onClick={() => go(thisWeek)}>
            Diese Woche
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => go(addDays(start, 7))}
          >
            Nächste Woche →
          </Button>
        </div>
      </div>
      <nav aria-label="Schnellsprung" className="flex flex-wrap gap-2">
        {jumps.map((w) => (
          <Button
            key={w}
            size="sm"
            variant={w === start ? "default" : "outline"}
            aria-current={w === start ? "true" : undefined}
            onClick={() => go(w)}
          >
            KW {isoWeek(w)}
          </Button>
        ))}
      </nav>
      {!desktop && (
        <p className="text-sm text-muted-foreground">
          Auf dem Handy nur lesen – geplant wird am PC.
        </p>
      )}

      {query.isPending && (
        <p className="text-muted-foreground">Schichtplan wird geladen …</p>
      )}
      {query.isError && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            Der Schichtplan konnte nicht geladen werden.
            <Button size="sm" variant="outline" onClick={() => query.refetch()}>
              Erneut versuchen
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {week && week.locations.length === 0 && (
        <p className="text-muted-foreground">Noch keine aktiven Standorte.</p>
      )}

      {week && week.locations.length > 1 && (
        <nav aria-label="Standorte" className="flex flex-wrap gap-3 text-sm">
          {week.locations.map((l) => (
            <a
              key={l.id}
              href={`#standort-${l.id}`}
              className="underline underline-offset-4"
            >
              {l.name}
            </a>
          ))}
        </nav>
      )}

      {week?.locations.map((location) => (
        <Card
          key={location.id}
          id={`standort-${location.id}`}
          className="scroll-mt-24"
        >
          <CardHeader>
            <CardTitle>{location.name}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {location.staffingWindows.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Kein Besetzungsbedarf hinterlegt.{" "}
                <Link
                  to={`/standorte/${location.id}/bedarf`}
                  className="underline underline-offset-4"
                >
                  Bedarf hinterlegen
                </Link>
              </p>
            )}
            <div className="grid gap-2 md:grid-cols-7">
              {days.map((d) => (
                <DayCell
                  key={d}
                  location={location}
                  date={d}
                  week={week}
                  editableWeek={desktop}
                  onAssign={setShift}
                />
              ))}
            </div>
            <ScheduleHistory locationId={location.id} week={week} />
          </CardContent>
        </Card>
      ))}

      {week && <HoursTable week={week} />}
      {week && shift && (
        <AssignDialog
          week={week}
          shift={shift}
          onClose={() => setShift(null)}
        />
      )}
    </PageShell>
  );
}

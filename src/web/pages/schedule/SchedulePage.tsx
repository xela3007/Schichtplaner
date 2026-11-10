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
  effectiveShifts,
  evaluateCandidate,
  hoursText,
  isOutdated,
  type ScheduleLocation,
  ScheduleWeek,
  toMin,
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
import { CopyList } from "./CopyList";
import { CopyWeekDialog } from "./CopyWeekDialog";
import { ScheduleHistory } from "./ScheduleHistory";
import { ResetCancelled, ShiftEditor } from "./ShiftEditor";
import { employeeColor, layoutLanes, timeRange } from "./timeline";

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

/** Notes in words for one assignment (ADR-011: never colour only). */
function notesFor(
  a: Assignment,
  week: ScheduleWeek,
  location: ScheduleLocation,
): string[] {
  const employee = week.employees.find((e) => e.id === a.employeeId);
  const notes: string[] = [];
  if (employee && !employee.active) notes.push("ausgeschieden");
  if (isOutdated(a, location, week.overrides)) notes.push("passt nicht mehr");
  // conflicts that appeared after the assignment (absence, rule, block, overlap)
  if (employee)
    for (const c of evaluateCandidate(
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
    ).blocks)
      notes.push(`Konflikt: ${c.message}`);
  return notes;
}

/** "Ben B." — short label for narrow bars; the full name is in title and aria. */
const shortName = (a: Assignment, week: ScheduleWeek) => {
  const e = week.employees.find((x) => x.id === a.employeeId);
  return e ? `${e.firstName} ${e.lastName.slice(0, 1)}.` : "unbekannt";
};

const nameOf = (a: Assignment, week: ScheduleWeek) => {
  const e = week.employees.find((x) => x.id === a.employeeId);
  return e ? `${e.lastName}, ${e.firstName}` : "unbekannt";
};

function NotePills({ notes }: { notes: string[] }) {
  return notes.map((n) => (
    <Pill
      key={n}
      variant={n.startsWith("Konflikt") ? "accent" : undefined}
      className={n === "passt nicht mehr" ? "border-dashed" : undefined}
    >
      {n}
    </Pill>
  ));
}

/** Details of the clicked bar: name, times, notes and "Austeilen". */
function AssignmentDetail({
  a,
  week,
  notes,
  editable,
  onClose,
}: {
  a: Assignment;
  week: ScheduleWeek;
  notes: string[];
  editable: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = nameOf(a, week);
  async function remove() {
    setError(null);
    try {
      await apiFetch(`/schedule/assignments/${a.id}?version=${a.version}`, {
        method: "DELETE",
        auth: true,
      });
      onClose();
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
  return (
    <div className="grid gap-1 rounded-md border bg-surface-inset p-1.5 text-caption">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{name}</span>
        <span className="tabular-nums text-ink-2">
          {a.start}–{a.end}
        </span>
        <NotePills notes={notes} />
      </span>
      {editable && !confirm && (
        <span className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2"
            onClick={() => setConfirm(true)}
            aria-label={`${name} austeilen`}
          >
            Austeilen
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2"
            onClick={onClose}
          >
            Schließen
          </Button>
        </span>
      )}
      {confirm && (
        <span className="flex flex-wrap items-center gap-1.5">
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
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}

const HOUR = 40; // px per hour in the timeline
const AXIS = "1.75rem"; // room for the hour labels

/** Outlook-like day timeline: demand tint, hatched gaps, one bar per assignment. */
function DayTimeline({
  location,
  date,
  week,
  here,
  notes,
  range,
  selected,
  onSelect,
}: {
  location: ScheduleLocation;
  date: string;
  week: ScheduleWeek;
  here: Assignment[];
  notes: Map<string, string[]>;
  range: { from: number; to: number };
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const top = (t: string) => ((toMin(t) - range.from * 60) * HOUR) / 60;
  const segments = coverageFor(location, date, here, week.overrides);
  const lanes = layoutLanes(here);
  const hours = Array.from(
    { length: range.to - range.from + 1 },
    (_, i) => range.from + i,
  );
  return (
    <div
      className="relative overflow-hidden rounded-sm border bg-surface"
      style={{ height: (range.to - range.from) * HOUR }}
      data-testid="timeline"
    >
      {segments
        .filter((s) => s.required > 0)
        .map((s) => (
          <div
            key={`${s.start}-${s.end}`}
            aria-hidden
            className={cn(
              "absolute right-0",
              s.status === "gap" ? "bg-destructive-100" : "bg-brand-050",
            )}
            style={{
              left: AXIS,
              top: top(s.start),
              height: top(s.end) - top(s.start),
              backgroundImage:
                s.status === "gap"
                  ? "repeating-linear-gradient(135deg, transparent 0 6px, rgba(200,71,47,.18) 6px 8px)"
                  : undefined,
            }}
          ></div>
        ))}
      {hours.map((h) => (
        <div
          key={h}
          aria-hidden
          className="pointer-events-none absolute right-0 left-0 border-t border-border"
          style={{ top: (h - range.from) * HOUR }}
        >
          <span className="absolute left-0.5 top-0 text-[10px] leading-none text-ink-3 tabular-nums">
            {String(h).padStart(2, "0")}
          </span>
        </div>
      ))}
      {here.map((a) => {
        const { lane, lanes: n } = lanes.get(a) ?? { lane: 0, lanes: 1 };
        const color = employeeColor(a.employeeId);
        const name = nameOf(a, week);
        const own = notes.get(a.id) ?? [];
        const employee = week.employees.find((e) => e.id === a.employeeId);
        const height = Math.max(top(a.end) - top(a.start), 22);
        return (
          <button
            key={a.id}
            type="button"
            title={`${name}, ${a.start}–${a.end}${own.length ? ` · ${own.join(" · ")}` : ""}`}
            aria-label={`${name}, ${a.start}–${a.end}${own.length ? ` (${own.join(", ")})` : ""}`}
            aria-pressed={selected === a.id}
            onClick={() => onSelect(selected === a.id ? null : a.id)}
            className={cn(
              "absolute overflow-hidden rounded-xs border border-l-4 px-1 py-0.5 text-left text-[11px] leading-tight text-ink shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              own.length > 0 && "border-dashed",
              selected === a.id && "ring-2 ring-ink",
            )}
            style={{
              top: top(a.start),
              height,
              left: `calc(${AXIS} + (100% - ${AXIS}) * ${lane / n})`,
              width: `calc((100% - ${AXIS}) / ${n} - 2px)`,
              background: color.bg,
              borderColor: own.length > 0 ? "var(--danger)" : color.border,
              borderLeftColor: color.border,
            }}
          >
            <span
              className={cn(
                "block truncate font-medium",
                employee && !employee.active && "line-through",
              )}
            >
              {own.length > 0 && "! "}
              {shortName(a, week)}
            </span>
            {height >= 34 && (
              <span className="block tabular-nums text-ink-2">
                {/* may wrap after the dash in narrow lanes */}
                {a.start}–{"\u200B"}
                {a.end}
              </span>
            )}
          </button>
        );
      })}
      {/* gap labels above the bars, so a bar never hides what is missing */}
      {segments
        .filter((s) => s.status === "gap")
        .map((s) => (
          <span
            key={`gap-${s.start}`}
            className="pointer-events-none absolute right-1 z-10 rounded-xs bg-surface/90 px-0.5 text-[11px] font-medium leading-tight text-destructive"
            style={{ top: Math.max(top(s.end) - 15, top(s.start)) }}
          >
            fehlt {s.required - s.assigned}
          </span>
        ))}
    </div>
  );
}

function DayCell({
  location,
  date,
  week,
  range,
  editableWeek,
  onAssign,
}: {
  location: ScheduleLocation;
  date: string;
  week: ScheduleWeek;
  range: { from: number; to: number };
  editableWeek: boolean;
  onAssign: (shift: Shift) => void;
}) {
  const day = weekdayOf(date);
  const past = date < week.today;
  const editable = editableWeek && !past;
  const open = location.openingHours.some((o) => o.weekday === day);
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const { shifts, cancelled } = effectiveShifts(location, date, week.overrides);
  const here = week.assignments.filter(
    (a) => a.locationId === location.id && a.date === date,
  );
  const notes = new Map(here.map((a) => [a.id, notesFor(a, week, location)]));
  const flagged = here.filter((a) => (notes.get(a.id) ?? []).length > 0);
  const chosen = here.find((a) => a.id === selected);
  const cov = coverageText(coverageFor(location, date, here, week.overrides));
  const dayLabel = `${SHORT[day]} ${formatDate(date, false)}`;
  return (
    <section
      aria-label={dayLabel}
      className={cn(
        "grid content-start gap-2 rounded-md border p-2 text-sm md:row-span-3 md:grid-rows-subgrid",
        past && "bg-paper-2",
        date === week.today && "border-brand-700",
      )}
    >
      <div className="grid content-start gap-1.5">
        <h3 className="flex flex-wrap items-baseline justify-between gap-1 font-medium">
          <span>{dayLabel}</span>
          {date === week.today && (
            <span className="text-caption text-brand-700">heute</span>
          )}
          {past && (
            <span className="text-caption text-muted-foreground">
              abgeschlossen
            </span>
          )}
        </h3>
        {shifts.length === 0 && cancelled.length === 0 && here.length === 0 && (
          <p className="text-muted-foreground">
            {open ? "kein Bedarf" : "geschlossen"}
          </p>
        )}
        {shifts.map((w) => {
          const key = `${w.start}-${w.end}`;
          const label = `${dayLabel} ${w.start}–${w.end}`;
          return (
            <div key={key} className="grid gap-1">
              <span className="flex flex-wrap items-center gap-1 text-caption tabular-nums text-ink-2">
                {w.start}–{w.end} · Soll {w.people}
                {w.source === "added" && (
                  <Pill variant="brand">zusätzlich</Pill>
                )}
                {w.source === "changed" && w.base && (
                  <Pill variant="brand">
                    angepasst (normal {w.base.start}–{w.base.end})
                  </Pill>
                )}
              </span>
              {editable && editing !== key && (
                <span className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2"
                    onClick={() =>
                      onAssign({ location, date, start: w.start, end: w.end })
                    }
                    aria-label={`${label} einteilen`}
                  >
                    + einteilen
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5"
                    onClick={() => setEditing(key)}
                    aria-label={`${label} anpassen`}
                  >
                    anpassen
                  </Button>
                </span>
              )}
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
            className="flex flex-wrap items-center gap-1 text-caption"
          >
            <span className="tabular-nums text-ink-2 line-through">
              {c.base.start}–{c.base.end}
            </span>
            <Pill>entfällt</Pill>
            {editable && (
              <ResetCancelled
                override={c.override}
                label={`${dayLabel} ${c.base.start}–${c.base.end}`}
              />
            )}
          </div>
        ))}
        {editable &&
          (editing === "new" ? (
            <ShiftEditor
              location={location}
              date={date}
              onDone={() => setEditing(null)}
            />
          ) : (
            <div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5"
                onClick={() => setEditing("new")}
                aria-label={`${dayLabel} Schicht hinzufügen`}
              >
                + Schicht
              </Button>
            </div>
          ))}
      </div>
      <DayTimeline
        location={location}
        date={date}
        week={week}
        here={here}
        notes={notes}
        range={range}
        selected={selected}
        onSelect={setSelected}
      />
      <div className="grid content-start gap-1.5">
        {chosen && (
          <AssignmentDetail
            key={chosen.id}
            a={chosen}
            week={week}
            notes={notes.get(chosen.id) ?? []}
            editable={editable}
            onClose={() => setSelected(null)}
          />
        )}
        {cov.status !== "none" && (
          <div className="grid gap-0.5">
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
        {flagged.length > 0 && (
          <div className="grid gap-1">
            <span className="text-caption text-ink-2">Hinweise</span>
            <ul className="grid gap-1 text-caption">
              {flagged.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-1">
                  <span>{nameOf(a, week)}</span>
                  <NotePills notes={notes.get(a.id) ?? []} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
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
  const [copying, setCopying] = useState(false);

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
    <PageShell wide>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-h3 font-bold">Schichtplan</h1>
          <p className="text-muted-foreground">
            KW {isoWeek(start)} · {formatDate(start, false)}–
            {formatDate(addDays(start, 6))}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {desktop && week && week.locations.length > 0 && (
            <Button size="sm" onClick={() => setCopying(true)}>
              Woche übernehmen
            </Button>
          )}
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
                  range={timeRange(
                    location,
                    days,
                    week.assignments.filter(
                      (a) => a.locationId === location.id,
                    ),
                    week.overrides,
                  )}
                  editableWeek={desktop}
                  onAssign={setShift}
                />
              ))}
            </div>
            <ScheduleHistory locationId={location.id} week={week} />
          </CardContent>
        </Card>
      ))}

      {week && week.locations.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <CopyList week={week} editable={desktop} />
          </CardContent>
        </Card>
      )}
      {week && <HoursTable week={week} />}
      {week && copying && (
        <CopyWeekDialog week={week} onClose={() => setCopying(false)} />
      )}
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

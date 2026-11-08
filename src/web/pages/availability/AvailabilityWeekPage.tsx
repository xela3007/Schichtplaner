import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import {
  type Absence,
  type AvailabilityRule,
  absencesOn,
  addDays,
  formatDate,
  formatRuleTime,
  IsoDate,
  isoWeek,
  mondayOf,
  rulesOn,
  WeekView,
  weekDays,
  weekdayOf,
} from "#shared/availability.js";
import type { Weekday } from "#shared/locations.js";
import { KindPill } from "@/components/AvailabilitySection";
import { PageShell } from "@/components/PageShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useCan } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const SHORT: Record<Weekday, string> = {
  mon: "Mo",
  tue: "Di",
  wed: "Mi",
  thu: "Do",
  fri: "Fr",
  sat: "Sa",
  sun: "So",
};

/** Today in Europe/Berlin as YYYY-MM-DD. */
export const todayInBerlin = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

function Entries({
  absences,
  rules,
}: {
  absences: Absence[];
  rules: AvailabilityRule[];
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      {absences.map((a) => (
        <span key={a.id} className="flex flex-wrap items-center gap-1">
          <KindPill kind={a.kind} compact />
          {a.startTime && (
            <span className="text-caption tabular-nums text-muted-foreground">
              {a.startTime}–{a.endTime}
            </span>
          )}
        </span>
      ))}
      {rules.map((r) => (
        <span key={r.id} className="text-caption text-ink-2">
          Regel: {formatRuleTime(r)}
        </span>
      ))}
    </div>
  );
}

/** /abwesenheiten — "Wer fehlt wann": active employees × 7 days; a list per day on phones. */
export function AvailabilityWeekPage() {
  const canView = useCan("availability.manage");
  const [params, setParams] = useSearchParams();
  const requested = IsoDate.safeParse(params.get("woche"));
  const today = todayInBerlin();
  const start = mondayOf(requested.success ? requested.data : today);
  const days = weekDays(start);

  const query = useQuery({
    queryKey: ["availability-week", start],
    queryFn: () =>
      apiFetch(`/availability/week?start=${start}`, {
        schema: WeekView,
        auth: true,
      }),
    enabled: canView,
  });

  if (!canView) {
    return (
      <PageShell>
        <Alert variant="destructive">
          <AlertDescription>
            Dir fehlt das Recht, Abwesenheiten zu pflegen.
          </AlertDescription>
        </Alert>
      </PageShell>
    );
  }

  const go = (date: string) => setParams({ woche: date });
  const data = query.data;
  const byEmployee = (id: string, date: string) => ({
    absences: absencesOn(
      data?.absences.filter((a) => a.employeeId === id) ?? [],
      date,
    ),
    rules: rulesOn(data?.rules.filter((r) => r.employeeId === id) ?? [], date),
  });

  return (
    <PageShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-h3 font-bold">Wer fehlt wann</h1>
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
          <Button variant="ghost" size="sm" onClick={() => go(mondayOf(today))}>
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

      {query.isPending && (
        <p className="text-muted-foreground">Wird geladen …</p>
      )}
      {query.isError && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            Die Übersicht konnte nicht geladen werden.
            <Button size="sm" variant="outline" onClick={() => query.refetch()}>
              Erneut versuchen
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {data && data.employees.length === 0 && (
        <p className="text-muted-foreground">Noch keine aktiven Mitarbeiter.</p>
      )}

      {data && data.employees.length > 0 && (
        <>
          {/* PC: grid employees × days */}
          <Card className="hidden md:block">
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full table-fixed border-collapse text-sm">
                <caption className="sr-only">
                  Abwesenheiten und Regeln der aktiven Mitarbeiter, KW{" "}
                  {isoWeek(start)}
                </caption>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="w-40 border-b p-2 text-left font-medium"
                    >
                      Mitarbeiter
                    </th>
                    {days.map((d) => (
                      <th
                        key={d}
                        scope="col"
                        className={cn(
                          "border-b p-2 text-left font-medium",
                          d === today && "bg-brand-050 text-brand-700",
                        )}
                      >
                        {SHORT[weekdayOf(d)]} {formatDate(d, false)}
                        {d === today && (
                          <span className="sr-only"> (heute)</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.employees.map((e) => (
                    <tr key={e.id} className="align-top">
                      <th
                        scope="row"
                        className="border-b p-2 text-left font-normal"
                      >
                        <Link
                          to={`/mitarbeiter/${e.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {e.lastName}, {e.firstName}
                        </Link>
                      </th>
                      {days.map((d) => (
                        <td
                          key={d}
                          className={cn(
                            "border-b p-2",
                            d === today && "bg-brand-050/40",
                          )}
                        >
                          <Entries {...byEmployee(e.id, d)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Phone: list per day */}
          <ol className="grid gap-3 md:hidden">
            {days.map((d) => {
              const missing = data.employees
                .map((e) => ({ e, ...byEmployee(e.id, d) }))
                .filter((x) => x.absences.length > 0 || x.rules.length > 0);
              return (
                <li key={d}>
                  <Card>
                    <CardContent className="grid gap-2 text-sm">
                      <h2
                        className={cn(
                          "font-heading text-base font-semibold",
                          d === today && "text-brand-700",
                        )}
                      >
                        {SHORT[weekdayOf(d)]} {formatDate(d, false)}
                        {d === today && " · heute"}
                      </h2>
                      {missing.length === 0 ? (
                        <p className="text-muted-foreground">Niemand fehlt.</p>
                      ) : (
                        <ul className="grid gap-2">
                          {missing.map(({ e, absences, rules }) => (
                            <li key={e.id} className="grid gap-1">
                              <Link
                                to={`/mitarbeiter/${e.id}`}
                                className="font-medium underline-offset-4 hover:underline"
                              >
                                {e.lastName}, {e.firstName}
                              </Link>
                              <Entries absences={absences} rules={rules} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </PageShell>
  );
}

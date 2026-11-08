import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";
import {
  Location,
  type OpeningHours,
  WEEKDAY_LABELS,
  WEEKDAYS,
  type Weekday,
} from "#shared/locations.js";
import {
  MAX_PEOPLE,
  Staffing,
  StaffingWindow,
  StaffingWindows,
  windowsOutsideOpeningHours,
} from "#shared/staffing.js";
import { PageShell } from "@/components/PageShell";
import { StaffingOverview } from "@/components/StaffingOverview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, apiFetch } from "@/lib/api";
import { useCan } from "@/lib/permissions";

const FormSchema = z.object({ windows: StaffingWindows });
type FormValues = z.infer<typeof FormSchema>;

const hoursText = (openingHours: OpeningHours, day: Weekday) =>
  openingHours
    .filter((o) => o.weekday === day)
    .map((o) => `${o.start}–${o.end}`)
    .join(", ");

/** Edit the staffing demand of one location (/standorte/:id/bedarf). Laid out for PC. */
export function StaffingFormPage() {
  const { id = "" } = useParams();
  const canManage = useCan("locations.manage");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [version, setVersion] = useState<number | null>(null);
  const [conflict, setConflict] = useState<Staffing | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The form is long and "Speichern" sits at the bottom: bring messages into view.
  const messages = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (conflict || error)
      messages.current?.scrollIntoView?.({
        block: "center",
      });
  }, [conflict, error]);

  const location = useQuery({
    queryKey: ["location", id],
    queryFn: () =>
      apiFetch(`/locations/${id}`, { schema: Location, auth: true }),
    enabled: canManage,
    retry: false,
  });
  const staffing = useQuery({
    queryKey: ["staffing", id],
    queryFn: () =>
      apiFetch(`/locations/${id}/staffing`, { schema: Staffing, auth: true }),
    enabled: canManage,
    retry: false,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { windows: [] },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "windows",
  });
  const { errors, isSubmitting } = form.formState;
  const watched = useWatch({ control: form.control, name: "windows" }) ?? [];

  useEffect(() => {
    if (staffing.data && version === null) {
      form.reset({ windows: staffing.data.windows });
      setVersion(staffing.data.version);
    }
  }, [staffing.data, version, form]);

  const openingHours = location.data?.openingHours ?? [];
  // Live check against the opening hours — same rule the server applies on save.
  const outside = new Set(windowsOutsideOpeningHours(watched, openingHours));
  const preview = watched.filter((w) => StaffingWindow.safeParse(w).success);

  const onSubmit = form.handleSubmit(async ({ windows }) => {
    setError(null);
    setConflict(null);
    if (windowsOutsideOpeningHours(windows, openingHours).length > 0) {
      setError(
        "Mindestens ein Zeitfenster liegt außerhalb der Öffnungszeiten.",
      );
      return;
    }
    try {
      const saved = await apiFetch(`/locations/${id}/staffing`, {
        method: "PUT",
        body: { windows, version },
        schema: Staffing,
        auth: true,
      });
      queryClient.setQueryData(["staffing", id], saved);
      navigate(`/standorte/${id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "version_conflict") {
        const current = Staffing.safeParse(
          (e.body as { current?: unknown } | null)?.current,
        );
        setConflict(current.success ? current.data : null);
      } else if (e instanceof ApiError && e.code === "outside_opening_hours") {
        // Opening hours changed since the page was loaded.
        void location.refetch();
        setError(
          "Die Öffnungszeiten wurden inzwischen geändert. Bitte die markierten Zeitfenster anpassen.",
        );
      } else if (e instanceof ApiError && e.code === "forbidden") {
        setError("Dir fehlt das Recht, Standorte zu verwalten.");
      } else {
        setError("Speichern fehlgeschlagen. Bitte erneut versuchen.");
      }
    }
  });

  function loadCurrent() {
    if (!conflict) return;
    form.reset({ windows: conflict.windows });
    setVersion(conflict.version);
    queryClient.setQueryData(["staffing", id], conflict);
    setConflict(null);
  }

  if (!canManage) {
    return (
      <PageShell>
        <Alert variant="destructive">
          <AlertDescription>
            Dir fehlt das Recht, Standorte zu verwalten.
          </AlertDescription>
        </Alert>
      </PageShell>
    );
  }
  if (location.isPending || staffing.isPending) {
    return (
      <PageShell>
        <p className="text-muted-foreground">Besetzungsbedarf wird geladen …</p>
      </PageShell>
    );
  }
  if (location.isError || staffing.isError) {
    return (
      <PageShell>
        <Alert variant="destructive">
          <AlertDescription>
            Besetzungsbedarf konnte nicht geladen werden.
          </AlertDescription>
        </Alert>
        <Link to="/standorte" className="underline underline-offset-4">
          Zur Übersicht
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Link
        to={`/standorte/${id}`}
        className="text-sm underline underline-offset-4"
      >
        ← Zurück
      </Link>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <Card>
          <CardHeader>
            <CardTitle>Besetzungsbedarf – {location.data.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} noValidate className="grid gap-5">
              <div ref={messages} className="grid gap-5 empty:hidden">
                {conflict && (
                  <Alert variant="destructive">
                    <AlertTitle>
                      Der Besetzungsbedarf wurde inzwischen von jemand anderem
                      geändert
                    </AlertTitle>
                    <AlertDescription className="grid gap-2">
                      <span>
                        Deine Änderungen wurden nicht gespeichert. Lade den
                        aktuellen Stand und trage sie dort erneut ein.
                      </span>
                      <span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={loadCurrent}
                        >
                          Aktuellen Stand laden
                        </Button>
                      </span>
                    </AlertDescription>
                  </Alert>
                )}
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Wie viele Personen brauchst du wann? Überlappende Zeitfenster
                werden addiert.
              </p>
              {WEEKDAYS.map((day) => {
                const hours = hoursText(openingHours, day);
                const entries = fields
                  .map((field, index) => ({ field, index }))
                  .filter(({ field }) => field.weekday === day);
                return (
                  <fieldset
                    key={day}
                    className="grid gap-2 rounded-md border p-3 sm:grid-cols-[8rem_1fr] sm:items-start"
                  >
                    <legend className="sr-only">{WEEKDAY_LABELS[day]}</legend>
                    <div className="pt-2 text-sm">
                      <div className="font-medium">{WEEKDAY_LABELS[day]}</div>
                      {hours && (
                        <div className="text-muted-foreground">{hours}</div>
                      )}
                    </div>
                    {!hours ? (
                      <p className="pt-2 text-sm text-muted-foreground">
                        geschlossen – kein Bedarf möglich
                      </p>
                    ) : (
                      <div className="grid gap-2">
                        {entries.map(({ field, index }, position) => {
                          const err = errors.windows?.[index];
                          const message =
                            err?.start?.message ??
                            err?.end?.message ??
                            err?.people?.message ??
                            err?.message ??
                            (outside.has(index)
                              ? `Liegt außerhalb der Öffnungszeiten (${hours}).`
                              : undefined);
                          const label = `${WEEKDAY_LABELS[day]}, Zeitfenster ${position + 1}`;
                          const errorId = `sw-${index}-error`;
                          const invalid = message ? true : undefined;
                          const describedBy = message ? errorId : undefined;
                          return (
                            <div key={field.id} className="grid gap-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <label
                                  htmlFor={`sw-${index}-start`}
                                  className="sr-only"
                                >
                                  {`${label}, Beginn`}
                                </label>
                                <Input
                                  id={`sw-${index}-start`}
                                  type="time"
                                  className="w-32"
                                  aria-invalid={invalid}
                                  aria-describedby={describedBy}
                                  {...form.register(
                                    `windows.${index}.start` as const,
                                  )}
                                />
                                <span aria-hidden="true">–</span>
                                <label
                                  htmlFor={`sw-${index}-end`}
                                  className="sr-only"
                                >
                                  {`${label}, Ende`}
                                </label>
                                <Input
                                  id={`sw-${index}-end`}
                                  type="time"
                                  className="w-32"
                                  aria-invalid={invalid}
                                  aria-describedby={describedBy}
                                  {...form.register(
                                    `windows.${index}.end` as const,
                                  )}
                                />
                                <label
                                  htmlFor={`sw-${index}-people`}
                                  className="text-sm"
                                >
                                  <span className="sr-only">{`${label}, `}</span>
                                  Personen
                                </label>
                                <Input
                                  id={`sw-${index}-people`}
                                  type="number"
                                  min={1}
                                  max={MAX_PEOPLE}
                                  className="w-20"
                                  aria-invalid={invalid}
                                  aria-describedby={describedBy}
                                  {...form.register(
                                    `windows.${index}.people` as const,
                                    { valueAsNumber: true },
                                  )}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => remove(index)}
                                  aria-label={`${label} entfernen`}
                                >
                                  Entfernen
                                </Button>
                              </div>
                              {message && (
                                <p
                                  id={errorId}
                                  role="alert"
                                  className="text-sm text-destructive"
                                >
                                  {message}
                                </p>
                              )}
                            </div>
                          );
                        })}
                        <div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const first = openingHours.find(
                                (o) => o.weekday === day,
                              );
                              append({
                                weekday: day,
                                start: first?.start ?? "08:00",
                                end: first?.end ?? "17:00",
                                people: 1,
                              });
                            }}
                          >
                            {`Zeitfenster hinzufügen (${WEEKDAY_LABELS[day]})`}
                          </Button>
                        </div>
                      </div>
                    )}
                  </fieldset>
                );
              })}
              <div className="flex gap-3">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Wird gespeichert …" : "Speichern"}
                </Button>
                <Link
                  to={`/standorte/${id}`}
                  className="self-center text-sm underline underline-offset-4"
                >
                  Abbrechen
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle>Gesamtübersicht (Vorschau)</CardTitle>
          </CardHeader>
          <CardContent>
            <StaffingOverview openingHours={openingHours} windows={preview} />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}

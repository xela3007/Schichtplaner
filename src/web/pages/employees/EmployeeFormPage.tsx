import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import {
  Employee,
  type EmployeeInput,
  formatMobile,
  PREFERENCE_LABELS,
  PREFERENCES,
} from "#shared/employees.js";
import type { Location } from "#shared/locations.js";
import { FormField } from "@/components/FormField";
import { PageShell } from "@/components/PageShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/lib/api";
import {
  EmployeeForm,
  type EmployeeFormIn,
  formatHours,
  hoursInput,
  useAllLocations,
  useCatalog,
  useContractTypes,
} from "@/lib/employees";
import { useCan } from "@/lib/permissions";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function toForm(
  e: Employee | undefined,
  activeLocations: Location[],
): EmployeeFormIn {
  return {
    firstName: e?.firstName ?? "",
    lastName: e?.lastName ?? "",
    mobile: e ? formatMobile(e.mobile) : "",
    email: e?.email ?? "",
    personnelNo: e?.personnelNo ?? "",
    contractTypeId: e?.contractTypeId ?? "",
    weeklyMinutesOverride: hoursInput(e?.weeklyMinutesOverride),
    isFloater: e?.isFloater ?? false,
    qualificationIds: e?.qualificationIds ?? [],
    systemAccessIds: e?.systemAccessIds ?? [],
    // one row per ACTIVE location; inactive ones stay untouched on the server
    locations: activeLocations.map((l) => {
      const stored = e?.locations.find((x) => x.locationId === l.id);
      return {
        locationId: l.id,
        trained: stored?.trained ?? false,
        preference: stored?.preference ?? "neutral",
      };
    }),
    note: e?.note ?? "",
  };
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="grid gap-4 border-t pt-4 first:border-0 first:pt-0">
      <legend className="mb-2 font-heading text-base font-semibold">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function CheckList({
  legend,
  items,
  selected,
  onChange,
  emptyHint,
}: {
  legend: string;
  items: { id: string; name: string; active: boolean }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  emptyHint: string;
}) {
  // active entries + already assigned inactive ones (marked)
  const visible = items.filter((i) => i.active || selected.includes(i.id));
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {visible.length === 0 && (
        <p className="text-sm text-muted-foreground">{emptyHint}</p>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {visible.map((i) => (
          <label key={i.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded-xs accent-brand-700"
              checked={selected.includes(i.id)}
              onChange={(ev) =>
                onChange(
                  ev.target.checked
                    ? [...selected, i.id]
                    : selected.filter((x) => x !== i.id),
                )
              }
            />
            {i.name}
            {!i.active && (
              <span className="text-muted-foreground">(deaktiviert)</span>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Create (/mitarbeiter/neu) and edit (/mitarbeiter/:id/bearbeiten). Laid out for PC. */
export function EmployeeFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const canManage = useCan("employees.manage");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const contractTypes = useContractTypes();
  const qualifications = useCatalog("qualifications");
  const systems = useCatalog("system-accesses");
  const locations = useAllLocations();
  const [version, setVersion] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [conflict, setConflict] = useState<Employee | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messages = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (conflict || error)
      messages.current?.scrollIntoView?.({ block: "center" });
  }, [conflict, error]);

  const existing = useQuery({
    queryKey: ["employee", id],
    queryFn: () =>
      apiFetch(`/employees/${id}`, { schema: Employee, auth: true }),
    enabled: editing && canManage,
    retry: false,
  });

  const activeLocations = (locations.data?.locations ?? []).filter(
    (l) => l.active,
  );
  const form = useForm<EmployeeFormIn, unknown, EmployeeInput>({
    resolver: zodResolver(EmployeeForm),
    defaultValues: toForm(undefined, []),
  });
  const { errors, isSubmitting } = form.formState;
  const [isFloater, qualificationIds, systemAccessIds, contractTypeId] =
    useWatch({
      control: form.control,
      name: [
        "isFloater",
        "qualificationIds",
        "systemAccessIds",
        "contractTypeId",
      ],
    });

  // Load once (and again only on "Aktuellen Stand laden"), when locations are known.
  useEffect(() => {
    if (loaded || !locations.data) return;
    if (editing && !existing.data) return;
    form.reset(
      toForm(
        existing.data,
        (locations.data.locations ?? []).filter((l) => l.active),
      ),
    );
    setVersion(existing.data?.version ?? null);
    setLoaded(true);
  }, [loaded, locations.data, editing, existing.data, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setConflict(null);
    try {
      const saved = editing
        ? await apiFetch(`/employees/${id}`, {
            method: "PUT",
            body: { ...values, version },
            schema: Employee,
            auth: true,
          })
        : await apiFetch("/employees", {
            method: "POST",
            body: values,
            schema: Employee,
            auth: true,
          });
      queryClient.setQueryData(["employee", saved.id], saved);
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
      void queryClient.invalidateQueries({ queryKey: ["contract-types"] });
      void queryClient.invalidateQueries({
        queryKey: ["employee-history", saved.id],
      });
      navigate(`/mitarbeiter/${saved.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "version_conflict") {
        const current = Employee.safeParse(
          (e.body as { current?: unknown } | null)?.current,
        );
        setConflict(current.success ? current.data : null);
      } else if (
        e instanceof ApiError &&
        (e.code === "invalid_reference" || e.code === "validation_failed")
      ) {
        const issues =
          (e.body as { issues?: { field: string; message: string }[] } | null)
            ?.issues ?? [];
        for (const issue of issues) {
          const field = issue.field.split(".")[0] as keyof EmployeeFormIn;
          form.setError(field, { message: issue.message });
        }
        setError("Bitte die markierten Angaben prüfen.");
        void queryClient.invalidateQueries({ queryKey: ["contract-types"] });
      } else if (e instanceof ApiError && e.code === "forbidden") {
        setError("Dir fehlt das Recht, Mitarbeiter zu verwalten.");
      } else {
        setError("Speichern fehlgeschlagen. Bitte erneut versuchen.");
      }
    }
  });

  function loadCurrent() {
    if (!conflict) return;
    form.reset(toForm(conflict, activeLocations));
    setVersion(conflict.version);
    queryClient.setQueryData(["employee", conflict.id], conflict);
    setConflict(null);
  }

  if (!canManage) {
    return (
      <PageShell>
        <Alert variant="destructive">
          <AlertDescription>
            Dir fehlt das Recht, Mitarbeiter zu verwalten.
          </AlertDescription>
        </Alert>
      </PageShell>
    );
  }
  const pending =
    !loaded ||
    contractTypes.isPending ||
    qualifications.isPending ||
    systems.isPending;
  const failed =
    existing.isError ||
    locations.isError ||
    contractTypes.isError ||
    qualifications.isError ||
    systems.isError;
  if (failed) {
    return (
      <PageShell>
        <Alert variant="destructive">
          <AlertDescription>
            Daten konnten nicht geladen werden.
          </AlertDescription>
        </Alert>
        <Link to="/mitarbeiter" className="underline underline-offset-4">
          Zur Übersicht
        </Link>
      </PageShell>
    );
  }
  if (pending) {
    return (
      <PageShell>
        <p className="text-muted-foreground">Formular wird geladen …</p>
      </PageShell>
    );
  }

  const types = (contractTypes.data?.items ?? []).filter(
    (t) => t.active || t.id === existing.data?.contractTypeId,
  );
  const selectedType = contractTypes.data?.items.find(
    (t) => t.id === contractTypeId,
  );
  const back = editing ? `/mitarbeiter/${id}` : "/mitarbeiter";

  return (
    <PageShell>
      <Link to={back} className="text-sm underline underline-offset-4">
        ← Zurück
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>
            {editing ? "Mitarbeiter bearbeiten" : "Mitarbeiter anlegen"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="grid gap-6">
            <div ref={messages} className="grid gap-4 empty:hidden">
              {conflict && (
                <Alert variant="destructive">
                  <AlertTitle>
                    Der Mitarbeiter wurde inzwischen von jemand anderem geändert
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

            <Section title="Person">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  id="firstName"
                  label="Vorname"
                  error={errors.firstName?.message}
                  {...form.register("firstName")}
                />
                <FormField
                  id="lastName"
                  label="Nachname"
                  error={errors.lastName?.message}
                  {...form.register("lastName")}
                />
                <FormField
                  id="personnelNo"
                  label="Personal-Nr. (optional)"
                  error={errors.personnelNo?.message}
                  {...form.register("personnelNo")}
                />
              </div>
            </Section>

            <Section title="Kontakt">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  id="mobile"
                  label="Handynummer"
                  type="tel"
                  autoComplete="off"
                  placeholder="z. B. 0151 23456789 oder +43 …"
                  error={errors.mobile?.message}
                  {...form.register("mobile")}
                />
                <FormField
                  id="email"
                  label="E-Mail privat (optional)"
                  type="email"
                  autoComplete="off"
                  error={errors.email?.message}
                  {...form.register("email")}
                />
              </div>
            </Section>

            <Section title="Vertrag">
              {types.length === 0 && (
                <Alert>
                  <AlertDescription>
                    Es gibt noch keinen Vertragstyp.{" "}
                    <Link
                      to="/mitarbeiter/listen"
                      className="underline underline-offset-4"
                    >
                      Lege zuerst einen in den Auswahllisten an.
                    </Link>
                  </AlertDescription>
                </Alert>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="contractTypeId">Vertragstyp</Label>
                  <select
                    id="contractTypeId"
                    className={selectClass}
                    aria-invalid={errors.contractTypeId ? true : undefined}
                    aria-describedby={
                      errors.contractTypeId ? "contractTypeId-error" : undefined
                    }
                    {...form.register("contractTypeId")}
                  >
                    <option value="">Bitte wählen …</option>
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({formatHours(t.weeklyMinutes)})
                        {t.active ? "" : " – deaktiviert"}
                      </option>
                    ))}
                  </select>
                  {errors.contractTypeId && (
                    <p
                      id="contractTypeId-error"
                      className="text-sm text-destructive"
                    >
                      {errors.contractTypeId.message}
                    </p>
                  )}
                </div>
                <FormField
                  id="weeklyMinutesOverride"
                  label="Abweichende Wochenstunden (optional)"
                  inputMode="decimal"
                  placeholder={
                    selectedType
                      ? `laut Vertrag ${formatHours(selectedType.weeklyMinutes)}`
                      : "z. B. 32"
                  }
                  error={errors.weeklyMinutesOverride?.message}
                  {...form.register("weeklyMinutesOverride")}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Abweichende Wochenstunden ersetzen die Stunden des Vertragstyps.
                Schichtlängen und max. Stunden pro Tag gelten weiter laut
                Vertrag.
              </p>
            </Section>

            <Section title="Qualifikationen und Systemzugänge">
              <CheckList
                legend="Qualifikationen"
                items={qualifications.data?.items ?? []}
                selected={qualificationIds ?? []}
                onChange={(ids) =>
                  form.setValue("qualificationIds", ids, { shouldDirty: true })
                }
                emptyHint="Noch keine Qualifikationen in den Auswahllisten."
              />
              <CheckList
                legend="Systemzugänge"
                items={systems.data?.items ?? []}
                selected={systemAccessIds ?? []}
                onChange={(ids) =>
                  form.setValue("systemAccessIds", ids, { shouldDirty: true })
                }
                emptyHint="Noch keine Systemzugänge in den Auswahllisten."
              />
            </Section>

            <Section title="Standorte">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded-xs accent-brand-700"
                  {...form.register("isFloater")}
                />
                Springer – an allen Standorten eingearbeitet
              </label>
              {isFloater && (
                <p className="text-sm text-muted-foreground">
                  Als Springer gilt die Einarbeitung überall. Sperren und nötige
                  Qualifikationen gelten weiter.
                </p>
              )}
              {activeLocations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Keine aktiven Standorte.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {activeLocations.map((l, i) => (
                    <li
                      key={l.id}
                      className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_auto_12rem] sm:items-center"
                    >
                      <span className="font-medium">{l.name}</span>
                      <span className="flex items-center gap-2 text-sm">
                        {isFloater ? (
                          <input
                            id={`loc-${i}-trained`}
                            type="checkbox"
                            className="size-4 rounded-xs accent-brand-700"
                            checked
                            disabled
                            readOnly
                          />
                        ) : (
                          <input
                            id={`loc-${i}-trained`}
                            type="checkbox"
                            className="size-4 rounded-xs accent-brand-700"
                            {...form.register(
                              `locations.${i}.trained` as const,
                            )}
                          />
                        )}
                        <label htmlFor={`loc-${i}-trained`}>
                          <span className="sr-only">{`${l.name}: `}</span>
                          {isFloater
                            ? "eingearbeitet (Springer)"
                            : "eingearbeitet"}
                        </label>
                      </span>
                      <select
                        className={selectClass}
                        aria-label={`${l.name}: Vorliebe`}
                        {...form.register(`locations.${i}.preference` as const)}
                      >
                        {PREFERENCES.map((p) => (
                          <option key={p} value={p}>
                            {PREFERENCE_LABELS[p]}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Bemerkung">
              <div className="grid gap-2">
                <Label htmlFor="note">Kopfwissen (optional)</Label>
                <textarea
                  id="note"
                  rows={3}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  placeholder="z. B. kann keine Spätschicht wegen Kinderbetreuung"
                  aria-invalid={errors.note ? true : undefined}
                  {...form.register("note")}
                />
                {errors.note && (
                  <p className="text-sm text-destructive">
                    {errors.note.message}
                  </p>
                )}
              </div>
            </Section>

            <div className="flex gap-3">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Wird gespeichert …" : "Speichern"}
              </Button>
              <Link
                to={back}
                className="self-center text-sm underline underline-offset-4"
              >
                Abbrechen
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  );
}

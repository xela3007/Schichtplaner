import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import {
  ABSENCE_KIND_LABELS,
  ABSENCE_KINDS,
  type Absence,
  AbsenceInput,
  Absence as AbsenceSchema,
  type AvailabilityRule,
  EmployeeAvailability,
  formatAbsencePeriod,
  formatRule,
  isSoft,
  RuleInput,
  AvailabilityRule as RuleSchema,
} from "#shared/availability.js";
import { WEEKDAYS, type Weekday } from "#shared/locations.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { ApiError, apiFetch } from "@/lib/api";
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
const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Soft entries are marked by word AND dashed outline — never by colour alone (ADR-011). */
export function KindPill({
  kind,
  compact = false,
}: {
  kind: Absence["kind"];
  compact?: boolean;
}) {
  // In narrow grid cells labels may wrap — a rounded box reads better than a pill there.
  const shape = compact
    ? "max-w-full rounded-md whitespace-normal hyphens-auto [overflow-wrap:anywhere] text-left leading-tight py-1"
    : undefined;
  return isSoft(kind) ? (
    <Pill className={cn("border-dashed", shape)}>
      {ABSENCE_KIND_LABELS[kind]} · weich
    </Pill>
  ) : (
    <Pill variant="accent" className={shape}>
      {ABSENCE_KIND_LABELS[kind]}
    </Pill>
  );
}

function errorText(e: unknown) {
  return e instanceof ApiError && e.code === "version_conflict"
    ? "Der Eintrag wurde inzwischen von jemand anderem geändert. Die Liste zeigt jetzt den aktuellen Stand — bitte erneut versuchen."
    : "Speichern fehlgeschlagen. Bitte erneut versuchen.";
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

// --- Absence form (UI fields → the SAME schema the API uses) ----------------
const AbsenceForm = z
  .object({
    kind: z.enum(ABSENCE_KINDS),
    startDate: z.string(),
    endDate: z.string(),
    hourly: z.boolean(),
    startTime: z.string(),
    endTime: z.string(),
    note: z.string(),
  })
  .transform(
    (v): z.input<typeof AbsenceInput> => ({
      kind: v.kind,
      startDate: v.startDate,
      endDate: v.endDate || v.startDate,
      startTime: v.hourly ? v.startTime || null : null,
      endTime: v.hourly ? v.endTime || null : null,
      note: v.note,
    }),
  )
  .pipe(AbsenceInput);
type AbsenceFormIn = z.input<typeof AbsenceForm>;

function AbsenceEditor({
  employeeId,
  entry,
  onDone,
  onError,
}: {
  employeeId: string;
  entry?: Absence;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const form = useForm<AbsenceFormIn, unknown, AbsenceInput>({
    resolver: zodResolver(AbsenceForm),
    defaultValues: {
      kind: entry?.kind ?? "vacation",
      startDate: entry?.startDate ?? "",
      endDate: entry?.endDate ?? "",
      hourly: Boolean(entry?.startTime),
      startTime: entry?.startTime ?? "",
      endTime: entry?.endTime ?? "",
      note: entry?.note ?? "",
    },
  });
  const { errors, isSubmitting } = form.formState;
  const [startDate, endDate, hourly] = useWatch({
    control: form.control,
    name: ["startDate", "endDate", "hourly"],
  });
  const singleDay = !endDate || endDate === startDate;

  const submit = form.handleSubmit(async (values) => {
    try {
      if (entry) {
        await apiFetch(`/absences/${entry.id}`, {
          method: "PUT",
          body: { ...values, version: entry.version },
          schema: AbsenceSchema,
          auth: true,
        });
      } else {
        await apiFetch(`/employees/${employeeId}/absences`, {
          method: "POST",
          body: values,
          schema: AbsenceSchema,
          auth: true,
        });
      }
      onDone();
    } catch (e) {
      onError(errorText(e));
      onDone();
    }
  });

  const p = entry ? `abs-${entry.id}` : "abs-new";
  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid gap-3 rounded-md border p-3"
    >
      <p className="font-medium">
        {entry ? "Abwesenheit bearbeiten" : "Neue Abwesenheit"}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${p}-kind`}>Art</Label>
          <select
            id={`${p}-kind`}
            className={selectClass}
            {...form.register("kind")}
          >
            {ABSENCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {ABSENCE_KIND_LABELS[k]}
                {isSoft(k) ? " (weich)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${p}-start`}>Von</Label>
          <Input
            id={`${p}-start`}
            type="date"
            aria-invalid={errors.startDate ? true : undefined}
            {...form.register("startDate")}
          />
          <FieldError
            id={`${p}-start-error`}
            message={errors.startDate?.message}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${p}-end`}>Bis (leer = ein Tag)</Label>
          <Input
            id={`${p}-end`}
            type="date"
            aria-invalid={errors.endDate ? true : undefined}
            {...form.register("endDate")}
          />
          <FieldError id={`${p}-end-error`} message={errors.endDate?.message} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 rounded-xs accent-brand-700"
          disabled={!singleDay}
          {...form.register("hourly")}
        />
        nur stundenweise{" "}
        {!singleDay && (
          <span className="text-muted-foreground">(nur bei einem Tag)</span>
        )}
      </label>
      {hourly && singleDay && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${p}-from`}>Von (Uhrzeit)</Label>
            <Input
              id={`${p}-from`}
              type="time"
              aria-invalid={errors.startTime ? true : undefined}
              {...form.register("startTime")}
            />
            <FieldError
              id={`${p}-from-error`}
              message={errors.startTime?.message}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${p}-to`}>Bis (Uhrzeit)</Label>
            <Input
              id={`${p}-to`}
              type="time"
              aria-invalid={errors.endTime ? true : undefined}
              {...form.register("endTime")}
            />
            <FieldError
              id={`${p}-to-error`}
              message={errors.endTime?.message}
            />
          </div>
        </div>
      )}
      {!singleDay && errors.startTime && (
        <FieldError id={`${p}-time-error`} message={errors.startTime.message} />
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`${p}-note`}>Bemerkung (optional)</Label>
        <Input
          id={`${p}-note`}
          aria-invalid={errors.note ? true : undefined}
          {...form.register("note")}
        />
        <FieldError id={`${p}-note-error`} message={errors.note?.message} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting ? "Wird gespeichert …" : "Speichern"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}

// --- Rule form ----------------------------------------------------------------
const MODES = {
  allday: "ganztägig",
  from: "ab",
  until: "vor",
  window: "von–bis",
} as const;
type Mode = keyof typeof MODES;
const RuleForm = z
  .object({
    weekdays: z.array(z.enum(WEEKDAYS)),
    mode: z.enum(["allday", "from", "until", "window"]),
    startTime: z.string(),
    endTime: z.string(),
  })
  .transform(
    (v): z.input<typeof RuleInput> => ({
      weekdays: v.weekdays,
      startTime:
        v.mode === "from" || v.mode === "window" ? v.startTime || "" : null,
      endTime:
        v.mode === "until" || v.mode === "window" ? v.endTime || "" : null,
    }),
  )
  .pipe(RuleInput);
type RuleFormIn = z.input<typeof RuleForm>;

const modeOf = (r?: AvailabilityRule): Mode =>
  !r
    ? "allday"
    : r.startTime && r.endTime
      ? "window"
      : r.startTime
        ? "from"
        : r.endTime
          ? "until"
          : "allday";

function RuleEditor({
  employeeId,
  entry,
  onDone,
  onError,
}: {
  employeeId: string;
  entry?: AvailabilityRule;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const form = useForm<RuleFormIn, unknown, RuleInput>({
    resolver: zodResolver(RuleForm),
    defaultValues: {
      weekdays: entry?.weekdays ?? [],
      mode: modeOf(entry),
      startTime: entry?.startTime ?? "",
      endTime: entry?.endTime ?? "",
    },
  });
  const { errors, isSubmitting } = form.formState;
  const [weekdays, mode] = useWatch({
    control: form.control,
    name: ["weekdays", "mode"],
  });
  const setDays = (d: Weekday[]) =>
    form.setValue("weekdays", d, { shouldDirty: true });

  const submit = form.handleSubmit(async (values) => {
    try {
      if (entry) {
        await apiFetch(`/availability-rules/${entry.id}`, {
          method: "PUT",
          body: { ...values, version: entry.version },
          schema: RuleSchema,
          auth: true,
        });
      } else {
        await apiFetch(`/employees/${employeeId}/availability-rules`, {
          method: "POST",
          body: values,
          schema: RuleSchema,
          auth: true,
        });
      }
      onDone();
    } catch (e) {
      onError(errorText(e));
      onDone();
    }
  });

  const p = entry ? `rule-${entry.id}` : "rule-new";
  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid gap-3 rounded-md border p-3"
    >
      <p className="font-medium">
        {entry ? "Regel bearbeiten" : "Neue Regel „nicht verfügbar“"}
      </p>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Wochentage</legend>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {WEEKDAYS.map((d) => (
            <label key={d} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded-xs accent-brand-700"
                checked={(weekdays ?? []).includes(d)}
                onChange={(ev) =>
                  setDays(
                    ev.target.checked
                      ? [...(weekdays ?? []), d]
                      : (weekdays ?? []).filter((x) => x !== d),
                  )
                }
              />
              {SHORT[d]}
            </label>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setDays(["mon", "tue", "wed", "thu", "fri"])}
          >
            Mo–Fr
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setDays([...WEEKDAYS])}
          >
            täglich
          </Button>
        </div>
        <FieldError id={`${p}-days-error`} message={errors.weekdays?.message} />
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Zeit</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {(Object.keys(MODES) as Mode[]).map((m) => (
            <label key={m} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                value={m}
                className="size-4 accent-brand-700"
                {...form.register("mode")}
              />
              {MODES[m]}
            </label>
          ))}
        </div>
      </fieldset>
      {mode !== "allday" && (
        <div className="grid gap-3 sm:grid-cols-3">
          {(mode === "from" || mode === "window") && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${p}-from`}>
                {mode === "from" ? "Ab (Uhrzeit)" : "Von (Uhrzeit)"}
              </Label>
              <Input
                id={`${p}-from`}
                type="time"
                aria-invalid={errors.startTime ? true : undefined}
                {...form.register("startTime")}
              />
              <FieldError
                id={`${p}-from-error`}
                message={errors.startTime?.message}
              />
            </div>
          )}
          {(mode === "until" || mode === "window") && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${p}-to`}>
                {mode === "until" ? "Vor (Uhrzeit)" : "Bis (Uhrzeit)"}
              </Label>
              <Input
                id={`${p}-to`}
                type="time"
                aria-invalid={errors.endTime ? true : undefined}
                {...form.register("endTime")}
              />
              <FieldError
                id={`${p}-to-error`}
                message={errors.endTime?.message}
              />
            </div>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting ? "Wird gespeichert …" : "Speichern"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}

function DeleteConfirm({
  what,
  onConfirm,
  onCancel,
}: {
  what: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <fieldset
      aria-label="Bestätigung"
      className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
    >
      {what} löschen? Das lässt sich nicht rückgängig machen.
      <Button size="sm" variant="destructive" onClick={onConfirm}>
        Ja, löschen
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Abbrechen
      </Button>
    </fieldset>
  );
}

/** "Abwesenheiten & Verfügbarkeit" on the employee detail page (availability.manage). */
export function AvailabilitySection({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["availability", employeeId],
    queryFn: () =>
      apiFetch(`/employees/${employeeId}/availability`, {
        schema: EmployeeAvailability,
        auth: true,
      }),
  });
  // "absence:new" | "absence:<id>" | "rule:new" | "rule:<id>" | "delete-absence:<id>" | "delete-rule:<id>"
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setOpen(null);
    void queryClient.invalidateQueries({
      queryKey: ["availability", employeeId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["employee-history", employeeId],
    });
    void queryClient.invalidateQueries({ queryKey: ["availability-week"] });
  };
  const start = (key: string) => {
    setError(null);
    setOpen(key);
  };

  async function remove(
    kind: "absences" | "availability-rules",
    id: string,
    version: number,
  ) {
    try {
      await apiFetch(`/${kind}/${id}?version=${version}`, {
        method: "DELETE",
        auth: true,
      });
    } catch (e) {
      setError(errorText(e));
    }
    refresh();
  }

  const absences = query.data?.absences ?? [];
  const rules = query.data?.rules ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Abwesenheiten &amp; Verfügbarkeit</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 text-sm">
        {query.isPending && (
          <p className="text-muted-foreground">Wird geladen …</p>
        )}
        {query.isError && (
          <p className="text-destructive">
            Abwesenheiten konnten nicht geladen werden.
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <section className="grid gap-3" aria-labelledby="abs-heading">
          <h3 id="abs-heading" className="font-heading text-base font-semibold">
            Abwesenheiten
          </h3>
          {query.data && absences.length === 0 && (
            <p className="text-muted-foreground">
              Keine Abwesenheiten erfasst.
            </p>
          )}
          <ul className="grid gap-2">
            {absences.map((a) => (
              <li key={a.id} className="grid gap-2 border-b pb-2 last:border-0">
                {open === `absence:${a.id}` ? (
                  <AbsenceEditor
                    employeeId={employeeId}
                    entry={a}
                    onDone={refresh}
                    onError={setError}
                  />
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <KindPill kind={a.kind} />
                      <span className="tabular-nums">
                        {formatAbsencePeriod(a)}
                      </span>
                      {a.note && (
                        <span className="text-muted-foreground">
                          – {a.note}
                        </span>
                      )}
                    </span>
                    <span className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => start(`absence:${a.id}`)}
                        aria-label={`Abwesenheit ${formatAbsencePeriod(a)} bearbeiten`}
                      >
                        Bearbeiten
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => start(`delete-absence:${a.id}`)}
                        aria-label={`Abwesenheit ${formatAbsencePeriod(a)} löschen`}
                      >
                        Löschen
                      </Button>
                    </span>
                  </div>
                )}
                {open === `delete-absence:${a.id}` && (
                  <DeleteConfirm
                    what="Abwesenheit"
                    onConfirm={() => remove("absences", a.id, a.version)}
                    onCancel={() => setOpen(null)}
                  />
                )}
              </li>
            ))}
          </ul>
          {open === "absence:new" ? (
            <AbsenceEditor
              employeeId={employeeId}
              onDone={refresh}
              onError={setError}
            />
          ) : (
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => start("absence:new")}
              >
                Abwesenheit hinzufügen
              </Button>
            </div>
          )}
        </section>

        <section className="grid gap-3" aria-labelledby="rules-heading">
          <h3
            id="rules-heading"
            className="font-heading text-base font-semibold"
          >
            Regeln „nicht verfügbar“
          </h3>
          {query.data && rules.length === 0 && (
            <p className="text-muted-foreground">Keine Regeln erfasst.</p>
          )}
          <ul className="grid gap-2">
            {rules.map((r) => (
              <li key={r.id} className="grid gap-2 border-b pb-2 last:border-0">
                {open === `rule:${r.id}` ? (
                  <RuleEditor
                    employeeId={employeeId}
                    entry={r}
                    onDone={refresh}
                    onError={setError}
                  />
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>Nicht verfügbar: {formatRule(r)}</span>
                    <span className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => start(`rule:${r.id}`)}
                        aria-label={`Regel ${formatRule(r)} bearbeiten`}
                      >
                        Bearbeiten
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => start(`delete-rule:${r.id}`)}
                        aria-label={`Regel ${formatRule(r)} löschen`}
                      >
                        Löschen
                      </Button>
                    </span>
                  </div>
                )}
                {open === `delete-rule:${r.id}` && (
                  <DeleteConfirm
                    what="Regel"
                    onConfirm={() =>
                      remove("availability-rules", r.id, r.version)
                    }
                    onCancel={() => setOpen(null)}
                  />
                )}
              </li>
            ))}
          </ul>
          {open === "rule:new" ? (
            <RuleEditor
              employeeId={employeeId}
              onDone={refresh}
              onError={setError}
            />
          ) : (
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => start("rule:new")}
              >
                Regel hinzufügen
              </Button>
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

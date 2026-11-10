import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
  addDays,
  formatDate,
  isoWeek,
  mondayOf,
  weekdayOf,
} from "#shared/availability.js";
import type { Weekday } from "#shared/locations.js";
import {
  CopyInput,
  CopyResult,
  type CopySkip,
  MAX_COPY_TARGETS,
  type ScheduleWeek,
} from "#shared/schedule.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/lib/api";
import { todayInBerlin } from "@/lib/time";

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
const weekLabel = (start: string) =>
  `KW ${isoWeek(start)} · ${formatDate(start, false)}–${formatDate(addDays(start, 6), false)}`;

type Form = {
  sourceStart: string;
  targetStarts: string[];
  locationIds: string[];
};

/** Result of a copy: counts and the skipped list grouped by week (story 4456a836). */
function CopyResultView({
  result,
  onClose,
}: {
  result: CopyResult;
  onClose: () => void;
}) {
  const byWeek = new Map<string, CopySkip[]>();
  for (const s of result.skipped) {
    const w = mondayOf(s.date);
    byWeek.set(w, [...(byWeek.get(w) ?? []), s]);
  }
  const nothing =
    result.copied === 0 &&
    result.alreadyPresent === 0 &&
    result.skipped.length === 0;
  return (
    <div className="grid gap-3 text-sm">
      {nothing ? (
        <p>In der Quellwoche gibt es nichts zu übernehmen.</p>
      ) : (
        <p>
          <span className="font-medium">
            {result.copied}{" "}
            {result.copied === 1 ? "Einteilung" : "Einteilungen"} übernommen
          </span>
          {result.alreadyPresent > 0 &&
            ` · ${result.alreadyPresent} waren schon eingeteilt`}
        </p>
      )}
      {!nothing && result.skipped.length === 0 && <p>Alles übernommen.</p>}
      {result.skipped.length > 0 && (
        <div className="grid gap-2">
          <h3 className="font-medium">
            Nicht übernommen ({result.skipped.length})
          </h3>
          {[...byWeek.entries()].map(([w, list]) => (
            <section
              key={w}
              aria-label={`KW ${isoWeek(w)}`}
              className="grid gap-1"
            >
              <h4 className="text-caption text-ink-2">KW {isoWeek(w)}</h4>
              <ul className="grid gap-1">
                {list.map((s) => (
                  <li
                    key={`${s.employeeId}-${s.locationId}-${s.date}-${s.start}`}
                  >
                    {SHORT[weekdayOf(s.date)]} {formatDate(s.date, false)} ·{" "}
                    {s.locationName} · {s.employeeName} {s.start}–{s.end} –{" "}
                    {s.message}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="text-caption text-muted-foreground">
            Die Lücken siehst du danach im Plan. Diese Liste wird nicht
            gespeichert.
          </p>
        </div>
      )}
      <div>
        <Button onClick={onClose}>Schließen</Button>
      </div>
    </div>
  );
}

/** „Woche übernehmen“: source week → up to 4 target weeks, chosen locations (story 4456a836). */
export function CopyWeekDialog({
  week,
  onClose,
}: {
  week: ScheduleWeek;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const [result, setResult] = useState<CopyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const returnFocus = useRef<Element | null>(null);
  const thisWeek = mondayOf(todayInBerlin());
  const sources = Array.from({ length: 17 }, (_, i) =>
    addDays(thisWeek, 7 * (i - 8)),
  );
  const form = useForm<Form, unknown, CopyInput>({
    resolver: zodResolver(CopyInput),
    defaultValues: {
      sourceStart: week.start,
      targetStarts: [],
      locationIds: week.locations.map((l) => l.id),
    },
  });
  const source = useWatch({ control: form.control, name: "sourceStart" });
  const chosen =
    useWatch({ control: form.control, name: "targetStarts" }) ?? [];
  const targets = Array.from({ length: 8 }, (_, i) =>
    addDays(source, 7 * (i + 1)),
  ).filter((t) => t >= thisWeek);
  const errors = form.formState.errors;

  useEffect(() => {
    returnFocus.current = document.activeElement;
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (returnFocus.current as HTMLElement | null)?.focus?.();
    };
  });
  // a changed source week makes old targets meaningless
  useEffect(() => {
    if (source) form.setValue("targetStarts", []);
  }, [source, form]);

  function close() {
    if (result) {
      void queryClient.invalidateQueries({ queryKey: ["schedule-week"] });
      void queryClient.invalidateQueries({ queryKey: ["schedule-history"] });
      void queryClient.invalidateQueries({ queryKey: ["schedule-copies"] });
    }
    onClose();
  }

  const submit = form.handleSubmit(async (input) => {
    setError(null);
    try {
      setResult(
        await apiFetch("/schedule/copies", {
          method: "POST",
          body: input,
          schema: CopyResult,
          auth: true,
        }),
      );
    } catch (e) {
      const body =
        e instanceof ApiError
          ? (e.body as {
              reasons?: { message: string }[];
              issues?: { message: string }[];
            } | null)
          : null;
      setError(
        body?.reasons?.[0]?.message ??
          body?.issues?.[0]?.message ??
          "Übernehmen fehlgeschlagen. Bitte erneut versuchen.",
      );
    }
  });

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 pt-16">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="grid w-full max-w-xl gap-4 rounded-xl border bg-background p-5 shadow-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-heading text-lg font-semibold">
            Woche übernehmen
          </h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={close}
            aria-label="Schließen"
          >
            ✕
          </Button>
        </div>
        {result ? (
          <CopyResultView result={result} onClose={close} />
        ) : (
          <form className="grid gap-4" onSubmit={submit} noValidate>
            <div className="grid gap-1.5">
              <Label htmlFor={`${titleId}-source`}>Quellwoche</Label>
              <select
                id={`${titleId}-source`}
                className={selectClass}
                {...form.register("sourceStart")}
              >
                {sources.map((w) => (
                  <option key={w} value={w}>
                    {weekLabel(w)}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="grid gap-1.5">
              <legend className="mb-1 text-sm font-medium">
                Zielwochen (höchstens {MAX_COPY_TARGETS})
              </legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {targets.map((t) => {
                  const full =
                    chosen.length >= MAX_COPY_TARGETS && !chosen.includes(t);
                  return (
                    <label
                      key={t}
                      className="flex items-center gap-2 text-sm aria-disabled:text-muted-foreground"
                      aria-disabled={full || undefined}
                    >
                      <input
                        type="checkbox"
                        value={t}
                        disabled={full}
                        className="size-4 rounded-xs accent-brand-700"
                        {...form.register("targetStarts")}
                      />
                      {weekLabel(t)}
                    </label>
                  );
                })}
              </div>
              {chosen.length >= MAX_COPY_TARGETS && (
                <p className="text-caption text-muted-foreground">
                  höchstens {MAX_COPY_TARGETS} Zielwochen
                </p>
              )}
              {errors.targetStarts && (
                <p className="text-caption text-destructive">
                  {errors.targetStarts.message ??
                    errors.targetStarts.root?.message}
                </p>
              )}
            </fieldset>
            <fieldset className="grid gap-1.5">
              <legend className="mb-1 text-sm font-medium">Standorte</legend>
              {week.locations.map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    value={l.id}
                    className="size-4 rounded-xs accent-brand-700"
                    {...form.register("locationIds")}
                  />
                  {l.name}
                </label>
              ))}
              {errors.locationIds && (
                <p className="text-caption text-destructive">
                  {errors.locationIds.message ??
                    errors.locationIds.root?.message}
                </p>
              )}
            </fieldset>
            <p className="text-caption text-muted-foreground">
              Übernommen werden nur Einteilungen, ab heute. Was schon eingeteilt
              ist, bleibt. Wer abwesend oder gesperrt ist, wo die Schicht fehlt
              oder schon voll ist, wird nicht übernommen – du bekommst danach
              eine Liste.
            </p>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting
                  ? "Wird übernommen …"
                  : "Übernehmen"}
              </Button>
              <Button type="button" variant="ghost" onClick={close}>
                Abbrechen
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

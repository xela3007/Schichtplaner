import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  type EffectiveShift,
  OverrideTimes,
  type ScheduleLocation,
  ShiftOverride,
} from "#shared/schedule.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/lib/api";

type Request = {
  path: string;
  method: "POST" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
};
type Pending = { request: Request; count: number; names: string[] };

function errorText(e: unknown) {
  if (e instanceof ApiError) {
    if (e.code === "version_conflict")
      return "Die Schicht wurde inzwischen geändert. Der Plan zeigt jetzt den aktuellen Stand.";
    if (e.code === "already_overridden")
      return "Für diese Schicht gibt es an dem Tag schon eine Abweichung. Der Plan wurde neu geladen.";
    const body = e.body as {
      reasons?: { message: string }[];
      issues?: { message: string }[];
    } | null;
    const msg = body?.reasons?.[0]?.message ?? body?.issues?.[0]?.message;
    if (msg) return msg;
  }
  return "Speichern fehlgeschlagen. Bitte erneut versuchen.";
}

/**
 * Add a shift for one day, or adjust / cancel / reset / delete an existing one
 * (story 2b06b608). Removals of assignments always need a confirmation.
 */
export function ShiftEditor({
  location,
  date,
  shift,
  onDone,
}: {
  location: ScheduleLocation;
  date: string;
  /** undefined = new additional shift */
  shift?: EffectiveShift;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useForm<OverrideTimes>({
    resolver: zodResolver(OverrideTimes),
    defaultValues: {
      start: shift?.start ?? "17:00",
      end: shift?.end ?? "21:00",
      people: shift?.people ?? 1,
    },
  });
  const { errors } = form.formState;
  const override = shift?.override;
  const id = `edit-${location.id}-${date}-${shift ? `${shift.start}-${shift.end}` : "new"}`;

  async function send(request: Request, confirmed = false) {
    setBusy(true);
    setError(null);
    try {
      const path =
        request.method === "DELETE" && confirmed
          ? `${request.path}&removeAssignments=true`
          : request.path;
      const body =
        request.body && confirmed
          ? { ...request.body, removeAssignments: true }
          : request.body;
      await apiFetch(path, {
        method: request.method,
        body,
        schema: request.method === "DELETE" ? undefined : ShiftOverride,
        auth: true,
      });
      await queryClient.invalidateQueries({ queryKey: ["schedule-week"] });
      void queryClient.invalidateQueries({ queryKey: ["schedule-history"] });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === "has_assignments") {
        const b = e.body as { count?: number; names?: string[] } | null;
        setPending({ request, count: b?.count ?? 0, names: b?.names ?? [] });
      } else {
        setError(errorText(e));
        void queryClient.invalidateQueries({ queryKey: ["schedule-week"] });
      }
    } finally {
      setBusy(false);
    }
  }

  const save = form.handleSubmit((v) => {
    if (!shift)
      return send({
        path: "/schedule/overrides",
        method: "POST",
        body: { kind: "added", locationId: location.id, date, ...v },
      });
    if (override)
      return send({
        path: `/schedule/overrides/${override.id}`,
        method: "PUT",
        body: { ...v, version: override.version },
      });
    return send({
      path: "/schedule/overrides",
      method: "POST",
      body: {
        kind: "changed",
        locationId: location.id,
        date,
        baseStart: shift.start,
        baseEnd: shift.end,
        ...v,
      },
    });
  });
  const cancel = () =>
    override
      ? send({
          path: `/schedule/overrides/${override.id}`,
          method: "PUT",
          body: { cancelled: true, version: override.version },
        })
      : send({
          path: "/schedule/overrides",
          method: "POST",
          body: {
            kind: "cancelled",
            locationId: location.id,
            date,
            baseStart: shift?.start,
            baseEnd: shift?.end,
          },
        });
  const remove = () =>
    override &&
    send({
      path: `/schedule/overrides/${override.id}?version=${override.version}`,
      method: "DELETE",
    });

  if (pending) {
    return (
      <fieldset
        aria-label="Einteilungen entfernen"
        className="grid gap-2 rounded-md border p-2 text-caption"
      >
        <span>
          {pending.count}{" "}
          {pending.count === 1 ? "Einteilung passt" : "Einteilungen passen"}{" "}
          nicht mehr
          {pending.names.length > 0 && ` (${pending.names.join(", ")})`} –
          entfernen und speichern?
        </span>
        <span className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="destructive"
            className="h-7 px-2"
            disabled={busy}
            onClick={() => send(pending.request, true)}
          >
            Ja, entfernen und speichern
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => setPending(null)}
          >
            Abbrechen
          </Button>
        </span>
      </fieldset>
    );
  }

  return (
    <form
      onSubmit={save}
      noValidate
      className="grid gap-2 rounded-md border p-2 text-caption"
      aria-label={shift ? "Schicht anpassen" : "Schicht hinzufügen"}
    >
      <div className="grid grid-cols-2 gap-1.5">
        <div className="grid gap-1">
          <Label htmlFor={`${id}-from`} className="text-caption">
            Von
          </Label>
          <Input
            id={`${id}-from`}
            type="time"
            className="h-8 px-1.5"
            aria-invalid={errors.start ? true : undefined}
            {...form.register("start")}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${id}-to`} className="text-caption">
            Bis
          </Label>
          <Input
            id={`${id}-to`}
            type="time"
            className="h-8 px-1.5"
            aria-invalid={errors.end ? true : undefined}
            {...form.register("end")}
          />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${id}-people`} className="text-caption">
          Personen
        </Label>
        <Input
          id={`${id}-people`}
          type="number"
          min={1}
          max={20}
          className="h-8 px-1.5"
          aria-invalid={errors.people ? true : undefined}
          {...form.register("people", { valueAsNumber: true })}
        />
      </div>
      {(errors.start || errors.end || errors.people) && (
        <p className="text-destructive">
          {errors.end?.message ??
            errors.start?.message ??
            errors.people?.message}
        </p>
      )}
      {error && <p className="text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-1.5">
        <Button type="submit" size="sm" className="h-7 px-2" disabled={busy}>
          Speichern
        </Button>
        {shift && shift.source !== "added" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2"
            disabled={busy}
            onClick={cancel}
          >
            Entfällt
          </Button>
        )}
        {shift?.source === "changed" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2"
            disabled={busy}
            onClick={remove}
          >
            Auf Standard zurücksetzen
          </Button>
        )}
        {shift?.source === "added" && (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="h-7 px-2"
            disabled={busy}
            onClick={remove}
          >
            Schicht löschen
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          onClick={onDone}
        >
          Abbrechen
        </Button>
      </div>
    </form>
  );
}

/** Reset a cancelled standard shift (no form needed). */
export function ResetCancelled({
  override,
  label,
}: {
  override: ShiftOverride;
  label: string;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  async function reset() {
    setError(null);
    try {
      await apiFetch(
        `/schedule/overrides/${override.id}?version=${override.version}`,
        { method: "DELETE", auth: true },
      );
    } catch (e) {
      setError(errorText(e));
    }
    void queryClient.invalidateQueries({ queryKey: ["schedule-week"] });
    void queryClient.invalidateQueries({ queryKey: ["schedule-history"] });
  }
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-1.5"
        onClick={reset}
        aria-label={`${label} auf Standard zurücksetzen`}
      >
        zurücksetzen
      </Button>
      {error && <span className="text-caption text-destructive">{error}</span>}
    </>
  );
}

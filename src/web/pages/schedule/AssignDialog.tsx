import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { formatDate, weekdayOf } from "#shared/availability.js";
import type { Weekday } from "#shared/locations.js";
import {
  Assignment,
  assignmentWindowOk,
  hoursText,
  rankCandidates,
  type ScheduleLocation,
  type ScheduleWeek,
} from "#shared/schedule.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
export type Shift = {
  location: ScheduleLocation;
  date: string;
  start: string;
  end: string;
};

function serverMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.body as {
      reasons?: { message: string }[];
      issues?: { message: string }[];
    } | null;
    const parts =
      body?.reasons?.map((r) => r.message) ??
      body?.issues?.map((i) => i.message) ??
      [];
    if (parts.length)
      return `Nicht eingeteilt: ${parts.join(", ").replace(/\.$/, "")}.`;
  }
  return "Einteilen fehlgeschlagen. Bitte erneut versuchen.";
}

/** Dialog for one shift: optional partial time + ranked candidate list (story a238fced). */
export function AssignDialog({
  week,
  shift,
  onClose,
}: {
  week: ScheduleWeek;
  shift: Shift;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const [start, setStart] = useState(shift.start);
  const [end, setEnd] = useState(shift.end);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement;
    firstField.current?.focus();
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (returnFocus.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  const timeValid =
    /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && start < end;
  const timeError = !timeValid
    ? "Das Ende muss nach dem Beginn liegen."
    : !assignmentWindowOk(shift.location, week.overrides, {
          date: shift.date,
          start,
          end,
          shiftStart: shift.start,
          shiftEnd: shift.end,
        })
      ? "Liegt außerhalb der Öffnungszeiten und der Schicht."
      : null;
  const candidates = timeError
    ? []
    : rankCandidates(week, shift.location.id, { date: shift.date, start, end });

  async function choose(employeeId: string) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/schedule/assignments", {
        method: "POST",
        body: {
          locationId: shift.location.id,
          employeeId,
          date: shift.date,
          start,
          end,
          shiftStart: shift.start,
          shiftEnd: shift.end,
        },
        schema: Assignment,
        auth: true,
      });
      await queryClient.invalidateQueries({ queryKey: ["schedule-week"] });
      await queryClient.invalidateQueries({ queryKey: ["schedule-history"] });
      onClose();
    } catch (e) {
      setError(serverMessage(e));
      void queryClient.invalidateQueries({ queryKey: ["schedule-week"] });
    } finally {
      setBusy(false);
    }
  }

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
            {shift.location.name} · {SHORT[weekdayOf(shift.date)]}{" "}
            {formatDate(shift.date, false)} · {shift.start}–{shift.end}
          </h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            aria-label="Schließen"
          >
            ✕
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`${titleId}-from`}>Von</Label>
            <Input
              ref={firstField}
              id={`${titleId}-from`}
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${titleId}-to`}>Bis</Label>
            <Input
              id={`${titleId}-to`}
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Für eine Teilschicht die Zeiten anpassen – innerhalb der
          Öffnungszeiten des Standorts.
        </p>
        {timeError && <p className="text-sm text-destructive">{timeError}</p>}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <ul
          className="grid max-h-[50vh] gap-2 overflow-y-auto"
          aria-label="Mitarbeiter"
        >
          {candidates.length === 0 && !timeError && (
            <li className="text-sm text-muted-foreground">
              Keine aktiven Mitarbeiter.
            </li>
          )}
          {candidates.map(({ employee, blocks, warnings, free }) => {
            const blocked = blocks.length > 0;
            return (
              <li key={employee.id}>
                <button
                  type="button"
                  disabled={blocked || busy}
                  onClick={() => choose(employee.id)}
                  className={cn(
                    "grid w-full gap-1 rounded-md border p-3 text-left text-sm transition-colors",
                    blocked
                      ? "cursor-not-allowed bg-paper-2 text-ink-2"
                      : "hover:border-brand-700 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  )}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {employee.lastName}, {employee.firstName}
                    </span>
                    <span
                      className={cn("tabular-nums", free < 0 && "font-medium")}
                    >
                      {free >= 0
                        ? `noch ${hoursText(free)} frei`
                        : `${hoursText(-free)} über Soll`}
                    </span>
                  </span>
                  {blocked && (
                    <span>
                      Nicht einteilbar:{" "}
                      {blocks.map((b) => b.message).join(", ")}
                    </span>
                  )}
                  {warnings.length > 0 && (
                    <span className="flex flex-wrap gap-1.5">
                      {warnings.map((w) => (
                        <Pill
                          key={w.code + w.message}
                          className="border-dashed"
                        >
                          {w.message}
                        </Pill>
                      ))}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

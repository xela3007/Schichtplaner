import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { formatDate, IsoDate, weekdayOf } from "#shared/availability.js";
import type { Location } from "#shared/locations.js";
import { OverrideList, type ShiftOverride } from "#shared/schedule.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { apiFetch } from "@/lib/api";
import { SHORT_DAY } from "@/lib/locations";
import { todayInBerlin } from "@/lib/time";
import { ExceptionDay } from "./ExceptionDay";

const dayText = (date: string) =>
  `${SHORT_DAY[weekdayOf(date)]} ${formatDate(date, false)}`;

function Row({
  o,
  onEdit,
}: {
  o: ShiftOverride;
  onEdit: (date: string) => void;
}) {
  const times =
    o.kind === "cancelled"
      ? `${o.baseStart}–${o.baseEnd}`
      : `${o.start}–${o.end}`;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b py-1.5 last:border-b-0">
      <span className="w-20 tabular-nums">{dayText(o.date)}</span>
      <span
        className={
          o.kind === "cancelled"
            ? "tabular-nums text-ink-2 line-through"
            : "tabular-nums"
        }
      >
        {times}
      </span>
      {o.kind === "added" && <Pill variant="brand">zusätzlich</Pill>}
      {o.kind === "changed" && (
        <Pill variant="brand">
          angepasst (normal {o.baseStart}–{o.baseEnd})
        </Pill>
      )}
      {o.kind === "cancelled" && <Pill>entfällt</Pill>}
      {o.people !== null && <span className="text-ink-2">Soll {o.people}</span>}
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto h-6 px-1.5"
        onClick={() => onEdit(o.date)}
        aria-label={`Ausnahme am ${dayText(o.date)} ${times} bearbeiten`}
      >
        Bearbeiten
      </Button>
    </li>
  );
}

/**
 * Dated exceptions of a location (story 16bb5be3): list from today on plus the
 * editor for one chosen date. Needs schedule.manage — the caller checks it.
 */
export function ExceptionsCard({ location }: { location: Location }) {
  const today = todayInBerlin();
  const [params] = useSearchParams();
  const requested = IsoDate.safeParse(params.get("datum"));
  const initial =
    requested.success && requested.data >= today ? requested.data : "";
  const [date, setDate] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const fieldId = useId();
  const card = useRef<HTMLDivElement>(null);

  // Deep link from the week view: jump to the card.
  useEffect(() => {
    if (initial) card.current?.scrollIntoView?.({ block: "start" });
  }, [initial]);

  const list = useQuery({
    queryKey: ["overrides", location.id],
    queryFn: () =>
      apiFetch(`/schedule/overrides?locationId=${location.id}`, {
        schema: OverrideList,
        auth: true,
      }),
    enabled: location.active,
  });

  const open = (d: string) => {
    setDate(d);
    setDraft(d);
    card.current?.scrollIntoView?.({ block: "start" });
  };

  return (
    <Card id="ausnahmen" ref={card} className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Ausnahmen</CardTitle>
        <p className="text-sm text-muted-foreground">
          Abweichende Schichten an einzelnen Tagen: zusätzlich, andere Zeiten
          oder entfällt.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {!location.active ? (
          <p className="text-muted-foreground">
            Inaktive Standorte haben keine Ausnahmen.
          </p>
        ) : (
          <>
            {list.isPending && (
              <p className="text-muted-foreground">
                Ausnahmen werden geladen …
              </p>
            )}
            {list.isError && (
              <p className="text-destructive">
                Ausnahmen konnten nicht geladen werden.
              </p>
            )}
            {list.data?.overrides.length === 0 && (
              <p className="text-muted-foreground">Keine Ausnahmen ab heute.</p>
            )}
            {list.data && list.data.overrides.length > 0 && (
              <ul aria-label="Ausnahmen ab heute">
                {list.data.overrides.map((o) => (
                  <Row key={o.id} o={o} onEdit={open} />
                ))}
              </ul>
            )}
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft && draft >= today) setDate(draft);
              }}
            >
              <div className="grid gap-1">
                <Label htmlFor={fieldId}>Datum</Label>
                <Input
                  id={fieldId}
                  type="date"
                  min={today}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="h-9 w-44"
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                disabled={!draft || draft < today}
              >
                Ausnahme hinzufügen
              </Button>
            </form>
            {date && (
              <div className="rounded-md border p-3">
                <ExceptionDay key={date} locationId={location.id} date={date} />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

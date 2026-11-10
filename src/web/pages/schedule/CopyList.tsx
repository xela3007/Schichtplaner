import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { isoWeek } from "#shared/availability.js";
import { ScheduleCopy, type ScheduleWeek } from "#shared/schedule.js";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/locations";

const CopyList_ = z.object({ items: z.array(ScheduleCopy) });

/** "KW 46 → KW 47, 48 · Gebäude 21 · 24 übernommen, 18 noch vorhanden · von x am …" */
function CopyLine({
  copy,
  names,
  editable,
}: {
  copy: ScheduleCopy;
  names: Record<string, string>;
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function undo() {
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch(`/schedule/copies/${copy.id}/undo`, {
        method: "POST",
        body: { version: copy.version },
        auth: true,
      });
    } catch (e) {
      setMessage(
        e instanceof ApiError && e.code === "version_conflict"
          ? "Wurde inzwischen schon zurückgenommen."
          : "Zurücknehmen fehlgeschlagen.",
      );
    } finally {
      setBusy(false);
      setConfirm(false);
      void queryClient.invalidateQueries({ queryKey: ["schedule-copies"] });
      void queryClient.invalidateQueries({ queryKey: ["schedule-week"] });
      void queryClient.invalidateQueries({ queryKey: ["schedule-history"] });
    }
  }
  const targets = [...copy.targetStarts]
    .sort()
    .map((t) => isoWeek(t))
    .join(", ");
  const locs = copy.locationIds.map((id) => names[id] ?? "Standort").join(", ");
  return (
    <li className="grid gap-1">
      <span>
        <span className="font-medium">
          KW {isoWeek(copy.sourceStart)} → KW {targets}
        </span>{" "}
        · {locs} · {copy.copied} übernommen
        {!copy.undoneAt && `, ${copy.remaining} noch vorhanden`}
        <span className="text-muted-foreground">
          {" "}
          · von {copy.actorEmail ?? "unbekannt"} am{" "}
          {formatDateTime(copy.createdAt)}
          {copy.undoneAt &&
            ` · zurückgenommen am ${formatDateTime(copy.undoneAt)}`}
        </span>
      </span>
      {editable && !copy.undoneAt && copy.remaining > 0 && !confirm && (
        <span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2"
            onClick={() => setConfirm(true)}
            aria-label={`Übernahme KW ${isoWeek(copy.sourceStart)} → KW ${targets} rückgängig machen`}
          >
            Rückgängig
          </Button>
        </span>
      )}
      {confirm && (
        <span className="flex flex-wrap items-center gap-2 text-caption">
          {copy.remaining}{" "}
          {copy.remaining === 1 ? "Einteilung" : "Einteilungen"} ab heute
          entfernen? Vergangene Tage bleiben.
          <Button
            size="sm"
            variant="destructive"
            className="h-7 px-2"
            disabled={busy}
            onClick={undo}
          >
            Ja, entfernen
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => setConfirm(false)}
          >
            Abbrechen
          </Button>
        </span>
      )}
      {message && (
        <span className="text-caption text-destructive">{message}</span>
      )}
    </li>
  );
}

/** Collapsible „Übernahmen“: latest week copies, each undoable as a whole (story 4456a836). */
export function CopyList({
  week,
  editable,
}: {
  week: ScheduleWeek;
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["schedule-copies"],
    queryFn: () =>
      apiFetch("/schedule/copies", { schema: CopyList_, auth: true }),
    enabled: open,
  });
  const names = Object.fromEntries(week.locations.map((l) => [l.id, l.name]));
  return (
    <section aria-label="Übernahmen" className="grid gap-2 text-sm">
      <div>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Übernahmen ausblenden" : "Übernahmen anzeigen"}
        </Button>
      </div>
      {open && query.isPending && (
        <p className="text-muted-foreground">Übernahmen werden geladen …</p>
      )}
      {open && query.isError && (
        <p className="text-destructive">
          Übernahmen konnten nicht geladen werden.
        </p>
      )}
      {open && query.data?.items.length === 0 && (
        <p className="text-muted-foreground">Noch keine Wochen übernommen.</p>
      )}
      {open && query.data && query.data.items.length > 0 && (
        <ul className="grid gap-2">
          {query.data.items.map((c) => (
            <CopyLine key={c.id} copy={c} names={names} editable={editable} />
          ))}
        </ul>
      )}
    </section>
  );
}

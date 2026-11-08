import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";

/** Number of assignments from tomorrow on if the API asked for confirmation, else null. */
export function pendingAssignments(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.code !== "has_assignments")
    return null;
  const count = (error.body as { count?: unknown } | null)?.count;
  return typeof count === "number" ? count : null;
}

/** "Hat noch X Einteilungen ab morgen – entfernen und deaktivieren?" (story a238fced). */
export function RemoveAssignmentsConfirm({
  count,
  busy,
  onConfirm,
  onCancel,
}: {
  count: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <fieldset
      aria-label="Einteilungen entfernen"
      className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
    >
      Hat noch {count} {count === 1 ? "Einteilung" : "Einteilungen"} ab morgen –
      entfernen und deaktivieren?
      <Button
        size="sm"
        variant="destructive"
        disabled={busy}
        onClick={onConfirm}
      >
        Ja, entfernen und deaktivieren
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Abbrechen
      </Button>
    </fieldset>
  );
}

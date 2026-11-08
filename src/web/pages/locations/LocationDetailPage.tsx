import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import type { AuditEntry, OpeningHours } from "#shared/locations.js";
import {
  Location,
  LocationHistory,
  WEEKDAY_LABELS,
  WEEKDAYS,
} from "#shared/locations.js";
import { PageShell } from "@/components/PageShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { ApiError, apiFetch } from "@/lib/api";
import {
  compactWeek,
  dayText,
  formatDateTime,
  kindLabel,
} from "@/lib/locations";
import { useCan } from "@/lib/permissions";

const ACTION_LABELS: Record<AuditEntry["action"], string> = {
  created: "angelegt",
  updated: "geändert",
  deactivated: "deaktiviert",
  reactivated: "reaktiviert",
};
const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  kind: "Art",
  openingHours: "Öffnungszeiten",
  active: "Status",
};

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (field === "kind") return kindLabel(String(value));
  if (field === "active") return value ? "aktiv" : "deaktiviert";
  if (field === "openingHours")
    return compactWeek(value as OpeningHours).join("; ");
  return String(value);
}

function History({ id }: { id: string }) {
  const history = useQuery({
    queryKey: ["location-history", id],
    queryFn: () =>
      apiFetch(`/locations/${id}/history`, {
        schema: LocationHistory,
        auth: true,
      }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Änderungsverlauf</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {history.isPending && (
          <p className="text-muted-foreground">Verlauf wird geladen …</p>
        )}
        {history.isError && (
          <p className="text-destructive">
            Verlauf konnte nicht geladen werden.
          </p>
        )}
        {history.data?.entries.length === 0 && (
          <p className="text-muted-foreground">Noch keine Einträge.</p>
        )}
        <ol className="grid gap-3">
          {history.data?.entries.map((entry) => (
            <li key={entry.id} className="border-b pb-3 last:border-0">
              <div>
                <span className="font-medium">
                  {ACTION_LABELS[entry.action]}
                </span>{" "}
                von {entry.actorEmail ?? "unbekannt"} am{" "}
                {formatDateTime(entry.occurredAt)}
              </div>
              {entry.action === "updated" && (
                <ul className="mt-1 text-muted-foreground">
                  {Object.entries(entry.changes).map(([field, change]) => (
                    <li key={field}>
                      {FIELD_LABELS[field] ?? field}:{" "}
                      {formatValue(field, change.from)} →{" "}
                      {formatValue(field, change.to)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export function LocationDetailPage() {
  const { id = "" } = useParams();
  const canManage = useCan("locations.manage");
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const query = useQuery({
    queryKey: ["location", id],
    queryFn: () =>
      apiFetch(`/locations/${id}`, { schema: Location, auth: true }),
    retry: false,
  });

  const toggle = useMutation({
    mutationFn: (location: Location) =>
      apiFetch(
        `/locations/${location.id}/${location.active ? "deactivate" : "reactivate"}`,
        {
          method: "POST",
          body: { version: location.version },
          schema: Location,
          auth: true,
        },
      ),
    onSettled: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ["location", id] });
      void queryClient.invalidateQueries({ queryKey: ["locations"] });
      void queryClient.invalidateQueries({
        queryKey: ["location-history", id],
      });
    },
  });

  if (query.isPending)
    return (
      <PageShell>
        <p className="text-muted-foreground">Standort wird geladen …</p>
      </PageShell>
    );
  if (query.isError) {
    const missing =
      query.error instanceof ApiError && query.error.status === 404;
    return (
      <PageShell>
        <Alert variant="destructive">
          <AlertDescription>
            {missing
              ? "Diesen Standort gibt es nicht (mehr)."
              : "Standort konnte nicht geladen werden."}
          </AlertDescription>
        </Alert>
        <Link to="/standorte" className="underline underline-offset-4">
          Zur Übersicht
        </Link>
      </PageShell>
    );
  }

  const location = query.data;
  const conflict =
    toggle.error instanceof ApiError &&
    toggle.error.code === "version_conflict";
  return (
    <PageShell>
      <Link to="/standorte" className="text-sm underline underline-offset-4">
        ← Alle Standorte
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-h3 font-bold">{location.name}</h1>
        {!location.active && <Pill>deaktiviert</Pill>}
      </div>
      <p className="text-muted-foreground">{kindLabel(location.kind)}</p>

      <Card>
        <CardHeader>
          <CardTitle>Öffnungszeiten</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            {WEEKDAYS.map((day) => (
              <div key={day} className="contents">
                <dt className="text-muted-foreground">{WEEKDAY_LABELS[day]}</dt>
                <dd>{dayText(location.openingHours, day)}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {canManage && (
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={`/standorte/${location.id}/bearbeiten`}
            className={buttonVariants()}
          >
            Bearbeiten
          </Link>
          {!confirming ? (
            <Button variant="outline" onClick={() => setConfirming(true)}>
              {location.active ? "Deaktivieren" : "Reaktivieren"}
            </Button>
          ) : (
            <fieldset
              aria-label="Bestätigung"
              className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
            >
              {location.active
                ? "Standort deaktivieren? Mitarbeiter sehen ihn dann nicht mehr."
                : "Standort wieder aktivieren?"}
              <Button
                size="sm"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(location)}
              >
                {location.active ? "Ja, deaktivieren" : "Ja, reaktivieren"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
              >
                Abbrechen
              </Button>
            </fieldset>
          )}
        </div>
      )}
      {toggle.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {conflict
              ? "Der Standort wurde inzwischen von jemand anderem geändert. Die Ansicht zeigt jetzt den aktuellen Stand — bitte erneut versuchen."
              : "Aktion fehlgeschlagen. Bitte erneut versuchen."}
          </AlertDescription>
        </Alert>
      )}

      {canManage && <History id={location.id} />}
    </PageShell>
  );
}

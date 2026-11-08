import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { LocationList } from "#shared/locations.js";
import { PageShell } from "@/components/PageShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { apiFetch } from "@/lib/api";
import { compactWeek, kindLabel } from "@/lib/locations";
import { useCan } from "@/lib/permissions";

export function LocationListPage() {
  const canManage = useCan("locations.manage");
  const [showInactive, setShowInactive] = useState(false);
  const includeInactive = canManage && showInactive;

  const query = useQuery({
    queryKey: ["locations", { includeInactive }],
    queryFn: () =>
      apiFetch(`/locations${includeInactive ? "?includeInactive=true" : ""}`, {
        schema: LocationList,
        auth: true,
      }),
  });

  return (
    <PageShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-h3 font-bold">Standorte</h1>
        {canManage && (
          <Link to="/standorte/neu" className={buttonVariants()}>
            Standort anlegen
          </Link>
        )}
      </div>

      {canManage && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 rounded-xs accent-brand-700"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Deaktivierte anzeigen
        </label>
      )}

      {query.isPending && (
        <p className="text-muted-foreground">Standorte werden geladen …</p>
      )}
      {query.isError && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            Standorte konnten nicht geladen werden.
            <Button size="sm" variant="outline" onClick={() => query.refetch()}>
              Erneut versuchen
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {query.data && query.data.locations.length === 0 && (
        <p className="text-muted-foreground">
          Noch keine Standorte.
          {canManage ? " Lege den ersten über „Standort anlegen“ an." : ""}
        </p>
      )}

      <ul className="grid gap-3">
        {query.data?.locations.map((location) => (
          <li key={location.id}>
            <Link
              to={`/standorte/${location.id}`}
              className="block rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Card
                className={`transition-[transform,box-shadow,border-color] duration-[var(--dur-fast)] hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lg ${location.active ? "" : "opacity-70"}`}
              >
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {location.name}
                    {!location.active && <Pill>deaktiviert</Pill>}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {kindLabel(location.kind)}
                  </p>
                </CardHeader>
                <CardContent className="text-sm">
                  {compactWeek(location.openingHours).map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}

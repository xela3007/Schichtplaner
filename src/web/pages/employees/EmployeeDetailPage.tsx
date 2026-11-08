import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  Employee,
  effectiveWeeklyMinutes,
  formatMobile,
  isTrainedAt,
  PREFERENCE_LABELS,
  type Preference,
  preferenceAt,
} from "#shared/employees.js";
import { type AuditEntry, LocationHistory } from "#shared/locations.js";
import { PageShell } from "@/components/PageShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { ApiError, apiFetch } from "@/lib/api";
import {
  formatHours,
  nameOf,
  useAllLocations,
  useCatalog,
  useContractTypes,
} from "@/lib/employees";
import { formatDateTime } from "@/lib/locations";
import { useCan } from "@/lib/permissions";

const ACTION_LABELS: Record<AuditEntry["action"], string> = {
  created: "angelegt",
  updated: "geändert",
  deactivated: "deaktiviert",
  reactivated: "reaktiviert",
};
const FIELD_LABELS: Record<string, string> = {
  firstName: "Vorname",
  lastName: "Nachname",
  personnelNo: "Personal-Nr.",
  mobile: "Handynummer",
  email: "E-Mail",
  contractTypeId: "Vertragstyp",
  weeklyMinutesOverride: "Abweichende Wochenstunden",
  isFloater: "Springer",
  note: "Bemerkung",
  qualificationIds: "Qualifikationen",
  systemAccessIds: "Systemzugänge",
  locations: "Standorte",
  active: "Status",
};
const PII = new Set(["mobile", "email"]);

type Lookup = {
  contractTypes: { id: string; name: string }[] | undefined;
  qualifications: { id: string; name: string }[] | undefined;
  systems: { id: string; name: string }[] | undefined;
  locations: { id: string; name: string }[] | undefined;
};

function formatValue(field: string, value: unknown, l: Lookup): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (field) {
    case "contractTypeId":
      return nameOf(l.contractTypes, String(value));
    case "weeklyMinutesOverride":
      return formatHours(Number(value));
    case "isFloater":
      return value ? "ja" : "nein";
    case "active":
      return value ? "aktiv" : "ausgeschieden";
    case "qualificationIds":
      return (
        (value as string[])
          .map((id) => nameOf(l.qualifications, id))
          .join(", ") || "—"
      );
    case "systemAccessIds":
      return (
        (value as string[]).map((id) => nameOf(l.systems, id)).join(", ") || "—"
      );
    case "locations":
      return (
        Object.entries(value as Record<string, string>)
          .map(([id, v]) => {
            const [trained, pref] = v.split("/");
            return `${nameOf(l.locations, id)}: ${trained === "trained" ? "eingearbeitet" : "nicht eingearbeitet"}, ${PREFERENCE_LABELS[pref as Preference] ?? pref}`;
          })
          .join("; ") || "—"
      );
    default:
      return String(value);
  }
}

function History({ id, lookup }: { id: string; lookup: Lookup }) {
  const history = useQuery({
    queryKey: ["employee-history", id],
    queryFn: () =>
      apiFetch(`/employees/${id}/history`, {
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
                      {FIELD_LABELS[field] ?? field}
                      {PII.has(field)
                        ? " geändert"
                        : `: ${formatValue(field, change.from, lookup)} → ${formatValue(field, change.to, lookup)}`}
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

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function EmployeeDetailPage() {
  const { id = "" } = useParams();
  const canManage = useCan("employees.manage");
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const contractTypes = useContractTypes();
  const qualifications = useCatalog("qualifications");
  const systems = useCatalog("system-accesses");
  const locations = useAllLocations();

  const query = useQuery({
    queryKey: ["employee", id],
    queryFn: () =>
      apiFetch(`/employees/${id}`, { schema: Employee, auth: true }),
    retry: false,
    enabled: canManage,
  });

  const toggle = useMutation({
    mutationFn: (e: Employee) =>
      apiFetch(`/employees/${e.id}/${e.active ? "deactivate" : "reactivate"}`, {
        method: "POST",
        body: { version: e.version },
        schema: Employee,
        auth: true,
      }),
    onSettled: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ["employee", id] });
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
      void queryClient.invalidateQueries({
        queryKey: ["employee-history", id],
      });
    },
  });

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
  if (query.isPending)
    return (
      <PageShell>
        <p className="text-muted-foreground">Mitarbeiter wird geladen …</p>
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
              ? "Diesen Mitarbeiter gibt es nicht."
              : "Mitarbeiter konnte nicht geladen werden."}
          </AlertDescription>
        </Alert>
        <Link to="/mitarbeiter" className="underline underline-offset-4">
          Zur Übersicht
        </Link>
      </PageShell>
    );
  }

  const e = query.data;
  const ct = contractTypes.data?.items.find((c) => c.id === e.contractTypeId);
  const hours = effectiveWeeklyMinutes(e, ct);
  const lookup: Lookup = {
    contractTypes: contractTypes.data?.items,
    qualifications: qualifications.data?.items,
    systems: systems.data?.items,
    locations: locations.data?.locations,
  };
  const entries = (
    list: { id: string; name: string; active: boolean }[] | undefined,
    ids: string[],
  ) =>
    ids.length === 0 ? (
      "—"
    ) : (
      <span className="flex flex-wrap gap-1.5">
        {ids.map((qid) => {
          const item = list?.find((x) => x.id === qid);
          return (
            <Pill
              key={qid}
              variant={item?.active === false ? "neutral" : "brand"}
            >
              {item?.name ?? "unbekannt"}
              {item?.active === false && " (deaktiviert)"}
            </Pill>
          );
        })}
      </span>
    );
  const activeLocations = (locations.data?.locations ?? []).filter(
    (l) => l.active,
  );
  const conflict =
    toggle.error instanceof ApiError &&
    toggle.error.code === "version_conflict";

  return (
    <PageShell>
      <Link to="/mitarbeiter" className="text-sm underline underline-offset-4">
        ← Alle Mitarbeiter
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-h3 font-bold">
          {e.firstName} {e.lastName}
        </h1>
        {e.isFloater && <Pill variant="brand">Springer</Pill>}
        {!e.active && <Pill>ausgeschieden</Pill>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profil</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
            <Row label="Personal-Nr.">{e.personnelNo ?? "—"}</Row>
            <Row label="Handynummer">{formatMobile(e.mobile)}</Row>
            <Row label="E-Mail (privat)">{e.email ?? "—"}</Row>
            <Row label="Vertragstyp">
              {ct?.name ?? "—"}
              {ct && !ct.active && " (deaktiviert)"}
            </Row>
            <Row label="Wochenstunden">
              {formatHours(hours)}/Woche{" "}
              <span className="text-muted-foreground">
                {e.weeklyMinutesOverride !== null && ct
                  ? `(abweichend vom Vertrag: ${formatHours(ct.weeklyMinutes)})`
                  : "(laut Vertrag)"}
              </span>
            </Row>
            {ct &&
              (ct.maxDailyMinutes !== null ||
                ct.allowedShiftMinutes.length > 0) && (
                <Row label="Schichten laut Vertrag">
                  {ct.allowedShiftMinutes.length > 0 &&
                    `${ct.allowedShiftMinutes.map((m) => formatHours(m).replace(" Std.", "")).join(" / ")} Std.`}
                  {ct.maxDailyMinutes !== null &&
                    ` · max. ${formatHours(ct.maxDailyMinutes)}/Tag`}
                </Row>
              )}
            <Row label="Springer">
              {e.isFloater ? "ja – an allen Standorten einsetzbar" : "nein"}
            </Row>
            <Row label="Qualifikationen">
              {entries(qualifications.data?.items, e.qualificationIds)}
            </Row>
            <Row label="Systemzugänge">
              {entries(systems.data?.items, e.systemAccessIds)}
            </Row>
            <Row label="Bemerkung">
              <span className="whitespace-pre-line">{e.note ?? "—"}</span>
            </Row>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Standorte</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {activeLocations.length === 0 ? (
            <p className="text-muted-foreground">Keine aktiven Standorte.</p>
          ) : (
            <ul className="grid gap-2">
              {activeLocations.map((l) => {
                const trained = isTrainedAt(e, l.id);
                const pref = preferenceAt(e, l.id);
                return (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0"
                  >
                    <span className="font-medium">{l.name}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={trained ? "" : "text-muted-foreground"}>
                        {trained
                          ? e.isFloater &&
                            !e.locations.some(
                              (x) => x.locationId === l.id && x.trained,
                            )
                            ? "eingearbeitet (Springer)"
                            : "eingearbeitet"
                          : "nicht eingearbeitet"}
                      </span>
                      {pref !== "neutral" && (
                        <Pill
                          variant={pref === "preferred" ? "brand" : "accent"}
                        >
                          {PREFERENCE_LABELS[pref]}
                        </Pill>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/mitarbeiter/${e.id}/bearbeiten`}
          className={buttonVariants()}
        >
          Bearbeiten
        </Link>
        {!confirming ? (
          <Button variant="outline" onClick={() => setConfirming(true)}>
            {e.active ? "Deaktivieren" : "Reaktivieren"}
          </Button>
        ) : (
          <fieldset
            aria-label="Bestätigung"
            className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
          >
            {e.active
              ? "Mitarbeiter deaktivieren? Er erscheint dann nicht mehr in der Übersicht, alle Angaben bleiben erhalten."
              : "Mitarbeiter wieder aktivieren?"}
            <Button
              size="sm"
              disabled={toggle.isPending}
              onClick={() => toggle.mutate(e)}
            >
              {e.active ? "Ja, deaktivieren" : "Ja, reaktivieren"}
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
      {toggle.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {conflict
              ? "Der Mitarbeiter wurde inzwischen von jemand anderem geändert. Die Ansicht zeigt jetzt den aktuellen Stand — bitte erneut versuchen."
              : "Aktion fehlgeschlagen. Bitte erneut versuchen."}
          </AlertDescription>
        </Alert>
      )}

      <History id={e.id} lookup={lookup} />
    </PageShell>
  );
}

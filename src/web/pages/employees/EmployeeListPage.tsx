import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  effectiveWeeklyMinutes,
  isTrainedAt,
  matchesSearch,
} from "#shared/employees.js";
import { PageShell } from "@/components/PageShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import {
  formatHours,
  nameOf,
  useAllLocations,
  useCatalog,
  useContractTypes,
  useEmployees,
} from "@/lib/employees";
import { useCan, useCanAny } from "@/lib/permissions";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Filter({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className={selectClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">alle</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** /mitarbeiter — active employees; inactive ones only show up when searching. */
export function EmployeeListPage() {
  const canRead = useCanAny("employees.manage", "availability.manage");
  const canManage = useCan("employees.manage");
  const employees = useEmployees();
  const contractTypes = useContractTypes();
  const qualifications = useCatalog("qualifications");
  const systems = useCatalog("system-accesses");
  const locations = useAllLocations();
  const [term, setTerm] = useState("");
  const [qualification, setQualification] = useState("");
  const [system, setSystem] = useState("");
  const [location, setLocation] = useState("");

  const rows = useMemo(() => {
    const searching = term.trim().length > 0;
    return (employees.data?.employees ?? [])
      .filter((e) => (searching ? matchesSearch(e, term) : e.active))
      .filter(
        (e) => !qualification || e.qualificationIds.includes(qualification),
      )
      .filter((e) => !system || e.systemAccessIds.includes(system))
      .filter((e) => !location || isTrainedAt(e, location))
      .sort(
        (a, b) =>
          Number(b.active) - Number(a.active) ||
          a.lastName.localeCompare(b.lastName, "de") ||
          a.firstName.localeCompare(b.firstName, "de"),
      );
  }, [employees.data, term, qualification, system, location]);

  if (!canRead) {
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

  const filtering = Boolean(term.trim() || qualification || system || location);
  const noEmployees =
    employees.data?.employees.every((e) => !e.active) && !term.trim();
  return (
    <PageShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-h3 font-bold">Mitarbeiter</h1>
        {canManage && (
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/mitarbeiter/listen"
              className="text-sm underline underline-offset-4"
            >
              Auswahllisten verwalten
            </Link>
            <Link to="/mitarbeiter/neu" className={buttonVariants()}>
              Mitarbeiter anlegen
            </Link>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor="search">Suche</Label>
          <Input
            id="search"
            type="search"
            placeholder="Name oder Personal-Nr."
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <Filter
          id="f-qualification"
          label="Qualifikation"
          value={qualification}
          onChange={setQualification}
          options={(qualifications.data?.items ?? []).filter((q) => q.active)}
        />
        <Filter
          id="f-system"
          label="Systemzugang"
          value={system}
          onChange={setSystem}
          options={(systems.data?.items ?? []).filter((s) => s.active)}
        />
        <Filter
          id="f-location"
          label="Eingearbeitet an"
          value={location}
          onChange={setLocation}
          options={(locations.data?.locations ?? []).filter((l) => l.active)}
        />
      </div>
      {term.trim() && (
        <p className="text-sm text-muted-foreground">
          Die Suche findet auch ausgeschiedene Mitarbeiter.
        </p>
      )}

      {employees.isPending && (
        <p className="text-muted-foreground">Mitarbeiter werden geladen …</p>
      )}
      {employees.isError && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            Mitarbeiter konnten nicht geladen werden.
            <Button
              size="sm"
              variant="outline"
              onClick={() => employees.refetch()}
            >
              Erneut versuchen
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {noEmployees && !filtering && (
        <p className="text-muted-foreground">
          Noch keine Mitarbeiter. Lege den ersten über „Mitarbeiter anlegen“ an.
        </p>
      )}
      {employees.data && rows.length === 0 && filtering && (
        <p className="text-muted-foreground">Keine Treffer.</p>
      )}

      <ul className="grid gap-3">
        {rows.map((e) => {
          const ct = contractTypes.data?.items.find(
            (c) => c.id === e.contractTypeId,
          );
          const hours = effectiveWeeklyMinutes(e, ct);
          return (
            <li key={e.id}>
              <Link
                to={`/mitarbeiter/${e.id}`}
                className="block rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Card
                  className={`transition-[transform,box-shadow,border-color] duration-[var(--dur-fast)] hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lg ${e.active ? "" : "opacity-70"}`}
                >
                  <CardContent className="grid gap-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-heading text-base font-semibold">
                        {e.lastName}, {e.firstName}
                      </span>
                      {e.personnelNo && (
                        <span className="text-muted-foreground">
                          {e.personnelNo}
                        </span>
                      )}
                      {e.isFloater && <Pill variant="brand">Springer</Pill>}
                      {!e.active && <Pill>ausgeschieden</Pill>}
                    </div>
                    <div className="text-muted-foreground">
                      {ct?.name ?? "—"} · {formatHours(hours)}/Woche
                    </div>
                    {e.qualificationIds.length > 0 && (
                      <div>
                        {e.qualificationIds
                          .map((id) => nameOf(qualifications.data?.items, id))
                          .join(", ")}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
    </PageShell>
  );
}

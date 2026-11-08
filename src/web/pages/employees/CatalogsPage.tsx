import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import {
  CATALOG_LABELS,
  CatalogEntry,
  CatalogInput,
  type CatalogKind,
  ContractType,
  type ContractTypeInput,
} from "#shared/catalogs.js";
import { FormField } from "@/components/FormField";
import { PageShell } from "@/components/PageShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { ApiError, apiFetch } from "@/lib/api";
import {
  ContractTypeForm,
  type ContractTypeFormIn,
  formatHours,
  hoursInput,
  useCatalog,
  useContractTypes,
} from "@/lib/employees";
import { useCan } from "@/lib/permissions";

function errorText(e: unknown): string {
  if (e instanceof ApiError && e.code === "name_taken")
    return "Diesen Namen gibt es in der Liste schon.";
  if (e instanceof ApiError && e.code === "version_conflict")
    return "Der Eintrag wurde inzwischen von jemand anderem geändert. Die Liste zeigt jetzt den aktuellen Stand — bitte erneut versuchen.";
  if (e instanceof ApiError && e.code === "contract_type_in_use")
    return "Der Vertragstyp wird von Mitarbeitern genutzt — die Stunden können nicht mehr geändert werden. Lege für andere Stunden einen neuen Vertragstyp an.";
  return "Speichern fehlgeschlagen. Bitte erneut versuchen.";
}

/** Name-only form for adding or renaming an entry (same schema as the API). */
function NameForm({
  id,
  label,
  initial,
  submitLabel,
  onSave,
  onCancel,
}: {
  id: string;
  label: string;
  initial: string;
  submitLabel: string;
  onSave: (name: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const form = useForm<CatalogInput>({
    resolver: zodResolver(CatalogInput),
    defaultValues: { name: initial },
  });
  const [error, setError] = useState<string | null>(null);
  const submit = form.handleSubmit(async ({ name }) => {
    setError(null);
    try {
      await onSave(name);
      form.reset({ name: onCancel ? name : "" });
    } catch (e) {
      if (e instanceof ApiError && e.code === "name_taken")
        form.setError("name", { message: errorText(e) });
      else setError(errorText(e));
    }
  });
  return (
    <form onSubmit={submit} noValidate className="grid gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <FormField
            id={id}
            label={label}
            error={form.formState.errors.name?.message}
            {...form.register("name")}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={form.formState.isSubmitting}
          className="mb-0.5"
        >
          {submitLabel}
        </Button>
        {onCancel && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="mb-0.5"
          >
            Abbrechen
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

function ActiveToggle({
  showInactive,
  onChange,
  id,
}: {
  showInactive: boolean;
  onChange: (v: boolean) => void;
  id: string;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <input
        id={id}
        type="checkbox"
        className="size-4 rounded-xs accent-brand-700"
        checked={showInactive}
        onChange={(e) => onChange(e.target.checked)}
      />
      Deaktivierte anzeigen
    </label>
  );
}

function CatalogCard({ kind }: { kind: CatalogKind }) {
  const labels = CATALOG_LABELS[kind];
  const query = useCatalog(kind);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: [kind] });

  async function toggle(entry: CatalogEntry) {
    setError(null);
    try {
      await apiFetch(
        `/${kind}/${entry.id}/${entry.active ? "deactivate" : "reactivate"}`,
        {
          method: "POST",
          body: { version: entry.version },
          schema: CatalogEntry,
          auth: true,
        },
      );
    } catch (e) {
      setError(errorText(e));
    }
    await refresh();
  }

  const items = (query.data?.items ?? []).filter(
    (i) => showInactive || i.active,
  );
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>{labels.title}</CardTitle>
        <ActiveToggle
          id={`${kind}-inactive`}
          showInactive={showInactive}
          onChange={setShowInactive}
        />
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {query.isPending && (
          <p className="text-muted-foreground">Wird geladen …</p>
        )}
        {query.isError && (
          <p className="text-destructive">
            {labels.title} konnten nicht geladen werden.
          </p>
        )}
        {query.data && items.length === 0 && (
          <p className="text-muted-foreground">Noch keine Einträge.</p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <ul className="grid gap-2">
          {items.map((entry) => (
            <li key={entry.id} className="border-b pb-2 last:border-0">
              {editing === entry.id ? (
                <NameForm
                  id={`${kind}-${entry.id}`}
                  label={`${labels.singular} umbenennen`}
                  initial={entry.name}
                  submitLabel="Speichern"
                  onCancel={() => setEditing(null)}
                  onSave={async (name) => {
                    try {
                      await apiFetch(`/${kind}/${entry.id}`, {
                        method: "PUT",
                        body: { name, version: entry.version },
                        schema: CatalogEntry,
                        auth: true,
                      });
                      setEditing(null);
                    } finally {
                      await refresh();
                    }
                  }}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    {entry.name}
                    {!entry.active && <Pill>deaktiviert</Pill>}
                  </span>
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(entry.id)}
                      aria-label={`${entry.name} umbenennen`}
                    >
                      Umbenennen
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggle(entry)}
                      aria-label={`${entry.name} ${entry.active ? "deaktivieren" : "reaktivieren"}`}
                    >
                      {entry.active ? "Deaktivieren" : "Reaktivieren"}
                    </Button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
        <NameForm
          id={`${kind}-new`}
          label={
            kind === "qualifications"
              ? "Neue Qualifikation"
              : "Neuer Systemzugang"
          }
          initial=""
          submitLabel="Hinzufügen"
          onSave={async (name) => {
            await apiFetch(`/${kind}`, {
              method: "POST",
              body: { name },
              schema: CatalogEntry,
              auth: true,
            });
            await refresh();
          }}
        />
      </CardContent>
    </Card>
  );
}

const toForm = (ct?: ContractType): ContractTypeFormIn => ({
  name: ct?.name ?? "",
  weeklyMinutes: hoursInput(ct?.weeklyMinutes),
  typicalShiftMinutes: hoursInput(ct?.typicalShiftMinutes),
  allowedShiftMinutes: (ct?.allowedShiftMinutes ?? [])
    .map(hoursInput)
    .join("; "),
  maxDailyMinutes: hoursInput(ct?.maxDailyMinutes),
});

function ContractTypeEditor({
  entry,
  onDone,
}: {
  entry?: ContractType;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<ContractTypeFormIn, unknown, ContractTypeInput>({
    resolver: zodResolver(ContractTypeForm),
    defaultValues: toForm(entry),
  });
  const [error, setError] = useState<string | null>(null);
  const locked = entry?.inUse ?? false;
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      if (entry) {
        await apiFetch(`/contract-types/${entry.id}`, {
          method: "PUT",
          body: { ...values, version: entry.version },
          schema: ContractType,
          auth: true,
        });
      } else {
        await apiFetch("/contract-types", {
          method: "POST",
          body: values,
          schema: ContractType,
          auth: true,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["contract-types"] });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === "name_taken")
        form.setError("name", { message: errorText(e) });
      else setError(errorText(e));
      if (e instanceof ApiError && e.code !== "name_taken")
        await queryClient.invalidateQueries({ queryKey: ["contract-types"] });
    }
  });
  const hint = locked
    ? "Wird von Mitarbeitern genutzt – lege für andere Stunden einen neuen Vertragstyp an."
    : undefined;
  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid gap-3 rounded-md border p-3"
    >
      <p className="font-medium">
        {entry ? `Vertragstyp „${entry.name}“ bearbeiten` : "Neuer Vertragstyp"}
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <FormField
        id="ct-name"
        label="Name"
        error={errors.name?.message}
        {...form.register("name")}
      />
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          id="ct-weekly"
          label="Soll-Wochenstunden"
          inputMode="decimal"
          placeholder="z. B. 30"
          disabled={locked}
          error={errors.weeklyMinutes?.message}
          {...form.register("weeklyMinutes")}
        />
        <FormField
          id="ct-max"
          label="Max. Stunden pro Tag (optional)"
          inputMode="decimal"
          placeholder="z. B. 8"
          disabled={locked}
          error={errors.maxDailyMinutes?.message}
          {...form.register("maxDailyMinutes")}
        />
        <FormField
          id="ct-typical"
          label="Übliche Schichtlänge in Std. (optional)"
          inputMode="decimal"
          placeholder="z. B. 6"
          disabled={locked}
          error={errors.typicalShiftMinutes?.message}
          {...form.register("typicalShiftMinutes")}
        />
        <FormField
          id="ct-allowed"
          label="Erlaubte Schichtlängen in Std. (optional)"
          placeholder="z. B. 4; 6; 7,5"
          disabled={locked}
          error={
            errors.allowedShiftMinutes?.message ??
            (
              errors.allowedShiftMinutes as unknown as
                | Record<number, { message?: string }>
                | undefined
            )?.[0]?.message
          }
          {...form.register("allowedShiftMinutes")}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting ? "Wird gespeichert …" : "Speichern"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}

function ContractTypesCard() {
  const query = useContractTypes();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(entry: ContractType) {
    setError(null);
    try {
      await apiFetch(
        `/contract-types/${entry.id}/${entry.active ? "deactivate" : "reactivate"}`,
        {
          method: "POST",
          body: { version: entry.version },
          schema: ContractType,
          auth: true,
        },
      );
    } catch (e) {
      setError(errorText(e));
    }
    await queryClient.invalidateQueries({ queryKey: ["contract-types"] });
  }

  const items = (query.data?.items ?? []).filter(
    (i) => showInactive || i.active,
  );
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Vertragstypen</CardTitle>
        <ActiveToggle
          id="ct-inactive"
          showInactive={showInactive}
          onChange={setShowInactive}
        />
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {query.isPending && (
          <p className="text-muted-foreground">Wird geladen …</p>
        )}
        {query.isError && (
          <p className="text-destructive">
            Vertragstypen konnten nicht geladen werden.
          </p>
        )}
        {query.data && items.length === 0 && (
          <p className="text-muted-foreground">Noch keine Vertragstypen.</p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <ul className="grid gap-3">
          {items.map((ct) =>
            editing === ct.id ? (
              <li key={ct.id}>
                <ContractTypeEditor
                  entry={ct}
                  onDone={() => setEditing(null)}
                />
              </li>
            ) : (
              <li
                key={ct.id}
                className="flex flex-wrap items-start justify-between gap-2 border-b pb-3 last:border-0"
              >
                <div className="grid gap-0.5">
                  <span className="flex items-center gap-2 font-medium">
                    {ct.name}
                    {!ct.active && <Pill>deaktiviert</Pill>}
                  </span>
                  <span className="text-muted-foreground">
                    {formatHours(ct.weeklyMinutes)}/Woche
                    {ct.maxDailyMinutes !== null &&
                      ` · max. ${formatHours(ct.maxDailyMinutes)}/Tag`}
                    {ct.allowedShiftMinutes.length > 0 &&
                      ` · Schichten ${ct.allowedShiftMinutes.map((m) => formatHours(m).replace(" Std.", "")).join(" / ")} Std.`}
                    {ct.typicalShiftMinutes !== null &&
                      ` · üblich ${formatHours(ct.typicalShiftMinutes)}`}
                  </span>
                </div>
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(ct.id)}
                    aria-label={`${ct.name} bearbeiten`}
                  >
                    Bearbeiten
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggle(ct)}
                    aria-label={`${ct.name} ${ct.active ? "deaktivieren" : "reaktivieren"}`}
                  >
                    {ct.active ? "Deaktivieren" : "Reaktivieren"}
                  </Button>
                </span>
              </li>
            ),
          )}
        </ul>
        {editing === "new" ? (
          <ContractTypeEditor onDone={() => setEditing(null)} />
        ) : (
          <div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing("new")}
            >
              Vertragstyp anlegen
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** /mitarbeiter/listen — Auswahllisten for employee profiles. */
export function CatalogsPage() {
  const canManage = useCan("employees.manage");
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
  return (
    <PageShell>
      <Link to="/mitarbeiter" className="text-sm underline underline-offset-4">
        ← Mitarbeiter
      </Link>
      <h1 className="font-heading text-h3 font-bold">Auswahllisten</h1>
      <p className="text-muted-foreground">
        Einträge werden nie gelöscht, nur deaktiviert: Sie bleiben an
        bestehenden Profilen sichtbar, sind für neue Auswahl aber nicht mehr
        verfügbar.
      </p>
      <ContractTypesCard />
      <CatalogCard kind="qualifications" />
      <CatalogCard kind="system-accesses" />
    </PageShell>
  );
}

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import type { z } from "zod";
import {
  LOCATION_KIND_LABELS,
  LOCATION_KINDS,
  Location,
  LocationInput,
} from "#shared/locations.js";
import { FormField } from "@/components/FormField";
import { PageShell } from "@/components/PageShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { WeekdayHoursEditor } from "@/components/WeekdayHoursEditor";
import { ApiError, apiFetch } from "@/lib/api";
import { useCan } from "@/lib/permissions";

type FormIn = z.input<typeof LocationInput>;
type FormOut = z.output<typeof LocationInput>;

const EMPTY: FormIn = { name: "", kind: "reception", openingHours: [] };

function toForm(location: Location): FormIn {
  return {
    name: location.name,
    kind: location.kind,
    openingHours: location.openingHours,
  };
}

/** Create (/standorte/neu) and edit (/standorte/:id/bearbeiten). Laid out for PC. */
export function LocationFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const canManage = useCan("locations.manage");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [version, setVersion] = useState<number | null>(null);
  const [conflict, setConflict] = useState<Location | null>(null);
  const [error, setError] = useState<string | null>(null);

  const existing = useQuery({
    queryKey: ["location", id],
    queryFn: () =>
      apiFetch(`/locations/${id}`, { schema: Location, auth: true }),
    enabled: editing,
    retry: false,
  });

  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(LocationInput),
    defaultValues: EMPTY,
  });
  const { errors, isSubmitting } = form.formState;

  // Load the stored state once (and again only on explicit "Aktuellen Stand laden").
  useEffect(() => {
    if (existing.data && version === null) {
      form.reset(toForm(existing.data));
      setVersion(existing.data.version);
    }
  }, [existing.data, version, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setConflict(null);
    try {
      const saved = editing
        ? await apiFetch(`/locations/${id}`, {
            method: "PUT",
            body: { ...values, version },
            schema: Location,
            auth: true,
          })
        : await apiFetch("/locations", {
            method: "POST",
            body: values,
            schema: Location,
            auth: true,
          });
      void queryClient.invalidateQueries({ queryKey: ["locations"] });
      queryClient.setQueryData(["location", saved.id], saved);
      void queryClient.invalidateQueries({
        queryKey: ["location-history", saved.id],
      });
      navigate(`/standorte/${saved.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "name_taken") {
        form.setError("name", { message: "Diesen Namen gibt es schon." });
      } else if (e instanceof ApiError && e.code === "version_conflict") {
        const current = Location.safeParse(
          (e.body as { current?: unknown } | null)?.current,
        );
        setConflict(current.success ? current.data : null);
      } else if (e instanceof ApiError && e.code === "forbidden") {
        setError("Dir fehlt das Recht, Standorte zu verwalten.");
      } else {
        setError("Speichern fehlgeschlagen. Bitte erneut versuchen.");
      }
    }
  });

  function loadCurrent() {
    if (!conflict) return;
    form.reset(toForm(conflict));
    setVersion(conflict.version);
    queryClient.setQueryData(["location", conflict.id], conflict);
    setConflict(null);
  }

  if (!canManage) {
    return (
      <PageShell>
        <Alert variant="destructive">
          <AlertDescription>
            Dir fehlt das Recht, Standorte zu verwalten.
          </AlertDescription>
        </Alert>
      </PageShell>
    );
  }
  if (editing && existing.isPending)
    return (
      <PageShell>
        <p className="text-muted-foreground">Standort wird geladen …</p>
      </PageShell>
    );
  if (editing && existing.isError) {
    return (
      <PageShell>
        <Alert variant="destructive">
          <AlertDescription>
            Standort konnte nicht geladen werden.
          </AlertDescription>
        </Alert>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Link
        to={editing ? `/standorte/${id}` : "/standorte"}
        className="text-sm underline underline-offset-4"
      >
        ← Zurück
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>
            {editing ? "Standort bearbeiten" : "Standort anlegen"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="grid gap-5">
            {conflict && (
              <Alert variant="destructive">
                <AlertTitle>
                  Der Standort wurde inzwischen von jemand anderem geändert
                </AlertTitle>
                <AlertDescription className="grid gap-2">
                  <span>
                    Deine Änderungen wurden nicht gespeichert. Lade den
                    aktuellen Stand und trage sie dort erneut ein.
                  </span>
                  <span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={loadCurrent}
                    >
                      Aktuellen Stand laden
                    </Button>
                  </span>
                </AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <FormField
              id="name"
              label="Name"
              error={errors.name?.message}
              {...form.register("name")}
            />
            <div className="grid gap-2">
              <Label htmlFor="kind">Art</Label>
              <select
                id="kind"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                aria-invalid={errors.kind ? true : undefined}
                {...form.register("kind")}
              >
                {LOCATION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {LOCATION_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
              {errors.kind && (
                <p className="text-sm text-destructive">
                  {errors.kind.message}
                </p>
              )}
            </div>
            <WeekdayHoursEditor
              control={form.control}
              register={form.register}
              errors={errors}
            />
            <div className="flex gap-3">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Wird gespeichert …" : "Speichern"}
              </Button>
              <Link
                to={editing ? `/standorte/${id}` : "/standorte"}
                className="self-center text-sm underline underline-offset-4"
              >
                Abbrechen
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  );
}

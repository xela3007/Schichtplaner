import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { MeResponse } from "#shared/auth.js";
import { HealthResponse } from "#shared/health.js";
import { useAuth } from "@/auth/AuthProvider";
import { PageShell } from "@/components/PageShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

function HealthCard() {
  const health = useQuery({
    queryKey: ["health"],
    // 503 still carries a valid body ("degraded") — data, not a crash.
    queryFn: () =>
      apiFetch("/health", { schema: HealthResponse, acceptStatus: [503] }),
    refetchInterval: 30_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Systemstatus</CardTitle>
        <CardDescription>Erreichbarkeit von API und Datenbank</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {health.isPending && (
          <p className="text-muted-foreground">Status wird geladen …</p>
        )}
        {health.isError && (
          <Alert variant="destructive">
            <AlertTitle>API nicht erreichbar</AlertTitle>
            <AlertDescription className="flex items-center gap-3">
              Der Server antwortet nicht.
              <Button
                size="sm"
                variant="outline"
                onClick={() => health.refetch()}
              >
                Erneut versuchen
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {health.data && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
            <dt className="text-muted-foreground">API</dt>
            <dd
              className={
                health.data.status === "ok" ? "text-success" : "text-warning"
              }
            >
              {health.data.status === "ok" ? "läuft" : "eingeschränkt"}
            </dd>
            <dt className="text-muted-foreground">Datenbank</dt>
            <dd
              className={
                health.data.checks.database === "ok"
                  ? "text-success"
                  : "text-destructive"
              }
            >
              {health.data.checks.database === "ok"
                ? "erreichbar"
                : "nicht erreichbar"}
            </dd>
            <dt className="text-muted-foreground">Version</dt>
            <dd>
              {health.data.version}
              {health.data.commit ? ` (${health.data.commit.slice(0, 7)})` : ""}
            </dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function AccountCard() {
  const { status, logout } = useAuth();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch("/me", { schema: MeResponse, auth: true }),
    enabled: status === "authenticated",
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Konto</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {status === "loading" && (
          <p className="text-muted-foreground">Sitzung wird geprüft …</p>
        )}
        {status === "anonymous" && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-muted-foreground">Du bist nicht angemeldet.</p>
            <Link to="/login" className={cn(buttonVariants())}>
              Anmelden
            </Link>
            <Link
              to="/signup"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Registrieren
            </Link>
          </div>
        )}
        {status === "authenticated" && (
          <>
            {me.isPending && (
              <p className="text-muted-foreground">Konto wird geladen …</p>
            )}
            {me.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  Konto konnte nicht geladen werden.
                </AlertDescription>
              </Alert>
            )}
            {me.data && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
                <dt className="text-muted-foreground">E-Mail</dt>
                <dd>{me.data.email}</dd>
                <dt className="text-muted-foreground">Rechte</dt>
                <dd>
                  {me.data.permissions.length
                    ? me.data.permissions.join(", ")
                    : "keine"}
                </dd>
              </dl>
            )}
            <div>
              <Button variant="outline" onClick={() => void logout()}>
                Abmelden
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function HomePage() {
  return (
    <PageShell>
      <h1 className="text-2xl font-semibold">Willkommen</h1>
      <HealthCard />
      <AccountCard />
    </PageShell>
  );
}

import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { PageShell } from "@/components/PageShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

type State = "pending" | "verified" | "invalid";

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>(token ? "pending" : "invalid");
  const sent = useRef(false);

  // The token is single-use: call the API exactly once (StrictMode runs effects twice).
  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    apiFetch(`/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(() => setState("verified"))
      .catch(() => setState("invalid"));
  }, [token]);

  return (
    <PageShell>
      <Card className="mx-auto w-full max-w-sm">
        <CardHeader>
          <CardTitle>E-Mail-Bestätigung</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {state === "pending" && (
            <p className="text-muted-foreground">Wird bestätigt …</p>
          )}
          {state === "verified" && (
            <>
              <Alert variant="success">
                <AlertTitle>Adresse bestätigt</AlertTitle>
                <AlertDescription>
                  Du kannst dich jetzt anmelden.
                </AlertDescription>
              </Alert>
              <Link to="/login" className={buttonVariants()}>
                Zur Anmeldung
              </Link>
            </>
          )}
          {state === "invalid" && (
            <Alert variant="destructive">
              <AlertTitle>Link ungültig oder abgelaufen</AlertTitle>
              <AlertDescription>
                Der Bestätigungslink funktioniert nicht mehr. Registriere dich
                bitte erneut.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

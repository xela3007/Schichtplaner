import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import type { z } from "zod";
import { SignupRequest } from "#shared/auth.js";
import { FormField } from "@/components/FormField";
import { PageShell } from "@/components/PageShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, apiFetch } from "@/lib/api";

export function SignupPage() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<
    z.input<typeof SignupRequest>,
    unknown,
    z.output<typeof SignupRequest>
  >({
    resolver: zodResolver(SignupRequest),
    defaultValues: { email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (data) => {
    setError(null);
    try {
      await apiFetch("/auth/signup", { method: "POST", body: data });
      setDone(true);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "rate_limited"
          ? "Zu viele Registrierungen von diesem Anschluss. Bitte später erneut."
          : "Registrierung fehlgeschlagen. Bitte erneut versuchen.",
      );
    }
  });

  return (
    <PageShell>
      <Card className="mx-auto w-full max-w-sm">
        <CardHeader>
          <CardTitle>Registrieren</CardTitle>
        </CardHeader>
        <CardContent>
          {done ? (
            <Alert variant="success">
              <AlertTitle>Fast geschafft</AlertTitle>
              <AlertDescription>
                Wir haben dir einen Bestätigungslink geschickt. Öffne ihn, um
                dein Konto zu aktivieren.
              </AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={onSubmit} noValidate className="grid gap-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <FormField
                id="email"
                label="E-Mail"
                type="email"
                autoComplete="email"
                error={
                  errors.email && "Bitte gib eine gültige E-Mail-Adresse ein."
                }
                {...form.register("email")}
              />
              <FormField
                id="password"
                label="Passwort"
                type="password"
                autoComplete="new-password"
                error={
                  errors.password && "Das Passwort braucht 12 bis 128 Zeichen."
                }
                {...form.register("password")}
              />
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Wird gesendet …" : "Konto anlegen"}
              </Button>
              <p className="text-sm text-muted-foreground">
                Schon registriert?{" "}
                <Link to="/login" className="underline underline-offset-4">
                  Anmelden
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import type { z } from "zod";
import { LoginRequest } from "#shared/auth.js";
import { useAuth } from "@/auth/AuthProvider";
import { FormField } from "@/components/FormField";
import { PageShell } from "@/components/PageShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError } from "@/lib/api";

const MESSAGES: Record<string, string> = {
  invalid_credentials: "E-Mail oder Passwort falsch.",
  email_not_verified: "Bitte bestätige zuerst deine E-Mail-Adresse.",
  rate_limited: "Zu viele Versuche, bitte später erneut.",
  network_error: "Der Server ist nicht erreichbar.",
};

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<
    z.input<typeof LoginRequest>,
    unknown,
    z.output<typeof LoginRequest>
  >({
    resolver: zodResolver(LoginRequest),
    defaultValues: { email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      await login(email, password);
      navigate("/");
    } catch (e) {
      setError(
        (e instanceof ApiError && MESSAGES[e.code]) ||
          "Anmeldung fehlgeschlagen. Bitte erneut versuchen.",
      );
    }
  });

  return (
    <PageShell>
      <Card className="mx-auto w-full max-w-sm">
        <CardHeader>
          <CardTitle>Anmelden</CardTitle>
        </CardHeader>
        <CardContent>
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
              autoComplete="current-password"
              error={errors.password && "Bitte gib dein Passwort ein."}
              {...form.register("password")}
            />
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Anmeldung läuft …" : "Anmelden"}
            </Button>
            <p className="text-sm text-muted-foreground">
              Noch kein Konto?{" "}
              <Link to="/signup" className="underline underline-offset-4">
                Registrieren
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  );
}

import { Link } from "react-router";
import { PageShell } from "@/components/PageShell";

export function NotFoundPage() {
  return (
    <PageShell>
      <h1 className="text-2xl font-semibold">Seite nicht gefunden</h1>
      <Link to="/" className="underline underline-offset-4">
        Zur Startseite
      </Link>
    </PageShell>
  );
}

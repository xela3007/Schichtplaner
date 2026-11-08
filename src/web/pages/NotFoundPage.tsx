import { Link } from "react-router";
import { PageShell } from "@/components/PageShell";

export function NotFoundPage() {
  return (
    <PageShell>
      <h1 className="font-heading text-h3 font-bold">Seite nicht gefunden</h1>
      <Link to="/" className="underline underline-offset-4">
        Zur Startseite
      </Link>
    </PageShell>
  );
}

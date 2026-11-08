import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { useAuth } from "@/auth/AuthProvider";
import { useMe } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/** Nav entries; `anyOf` hides an entry from users without any of those permissions (UI hint only, ADR-010). */
const NAV: { to: string; label: string; anyOf?: string[] }[] = [
  { to: "/standorte", label: "Standorte" },
  {
    to: "/mitarbeiter",
    label: "Mitarbeiter",
    anyOf: ["employees.manage", "availability.manage"],
  },
  {
    to: "/abwesenheiten",
    label: "Abwesenheiten",
    anyOf: ["availability.manage"],
  },
];

/** App frame: sticky translucent header with the official Dinexis wordmark. */
export function PageShell({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const permissions = useMe().data?.permissions ?? [];
  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        {/* Wraps the nav into a second row on narrow phones instead of overlapping. */}
        <div className="mx-auto flex min-h-16 max-w-5xl flex-wrap items-center gap-x-6 gap-y-1 px-[clamp(16px,4vw,40px)] py-2">
          <Link
            to="/"
            className="flex items-center gap-3 rounded-sm"
            aria-label="Schichtplaner – Startseite"
          >
            <img
              src="/brand/dinexis.svg"
              alt="Dinexis"
              className="h-[18px] w-auto"
            />
            <span aria-hidden="true" className="h-5 w-px bg-border-strong" />
            <span className="font-heading text-[17px] font-semibold tracking-tight text-ink">
              Schichtplaner
            </span>
          </Link>
          {status === "authenticated" && (
            <nav aria-label="Hauptnavigation" className="flex gap-5 text-sm">
              {NAV.filter(
                (n) => !n.anyOf || n.anyOf.some((p) => permissions.includes(p)),
              ).map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) =>
                    cn(
                      "rounded-sm font-medium underline-offset-[6px] hover:text-brand-700 hover:underline",
                      isActive
                        ? "text-brand-700 underline decoration-2"
                        : "text-ink-2",
                    )
                  }
                >
                  {n.label}
                </NavLink>
              ))}
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-[clamp(16px,4vw,40px)] py-10">
        {children}
      </main>
    </div>
  );
}

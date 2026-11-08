import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/utils";

/** App frame: sticky translucent header with the official Dinexis wordmark. */
export function PageShell({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-6 px-[clamp(16px,4vw,40px)]">
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
              <NavLink
                to="/standorte"
                className={({ isActive }) =>
                  cn(
                    "rounded-sm font-medium underline-offset-[6px] hover:text-brand-700 hover:underline",
                    isActive
                      ? "text-brand-700 underline decoration-2"
                      : "text-ink-2",
                  )
                }
              >
                Standorte
              </NavLink>
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

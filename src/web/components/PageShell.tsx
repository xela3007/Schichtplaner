import type { ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "@/auth/AuthProvider";

export function PageShell({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  return (
    <div className="min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4">
          <Link to="/" className="font-semibold">
            Schichtplaner
          </Link>
          {status === "authenticated" && (
            <nav
              aria-label="Hauptnavigation"
              className="ml-6 flex gap-4 text-sm"
            >
              <Link to="/standorte" className="hover:underline">
                Standorte
              </Link>
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
        {children}
      </main>
    </div>
  );
}

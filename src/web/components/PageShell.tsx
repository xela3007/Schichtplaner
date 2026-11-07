import type { ReactNode } from "react";
import { Link } from "react-router";

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4">
          <Link to="/" className="font-semibold">
            Schichtplaner
          </Link>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
        {children}
      </main>
    </div>
  );
}

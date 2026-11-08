import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/auth/AuthProvider";
import { session } from "@/auth/session";
import { PageShell } from "./PageShell";

function renderShell() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <MemoryRouter>
          <PageShell>
            <p>Inhalt</p>
          </PageShell>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  session.reset();
});

describe("PageShell", () => {
  it("shows the official Dinexis wordmark and the product name", () => {
    session.clear();
    renderShell();
    const logo = screen.getByAltText("Dinexis") as HTMLImageElement;
    expect(logo.getAttribute("src")).toBe("/brand/dinexis.svg");
    expect(screen.getByText("Schichtplaner")).toBeTruthy();
  });

  it("shows the navigation only when logged in", () => {
    session.clear();
    renderShell();
    expect(
      screen.queryByRole("navigation", { name: "Hauptnavigation" }),
    ).toBeNull();
    cleanup();
    session.setToken("token");
    renderShell();
    expect(screen.getByRole("link", { name: "Standorte" })).toBeTruthy();
  });

  it("shows „Mitarbeiter“ only with employees.manage", async () => {
    for (const [permissions, visible] of [
      [[], false],
      [["employees.manage"], true],
    ] as const) {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                id: "01a1b4ea-7b22-7679-af8a-a22acdbb9001",
                email: "a@example.org",
                permissions,
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            ),
        ),
      );
      session.setToken("token");
      renderShell();
      await screen.findByRole("link", { name: "Standorte" });
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByRole("link", { name: "Mitarbeiter" }) !== null).toBe(
        visible,
      );
      cleanup();
      vi.unstubAllGlobals();
    }
  });
});

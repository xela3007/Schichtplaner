import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/auth/AuthProvider";
import { session } from "@/auth/session";
import { LoginPage } from "./LoginPage";

function renderLogin() {
  // Session already resolved, so the provider doesn't try a refresh.
  session.clear();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <MemoryRouter>
          <LoginPage />
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

describe("LoginPage", () => {
  it("shows German client-side validation messages without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderLogin();
    await userEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(
      await screen.findByText("Bitte gib eine gültige E-Mail-Adresse ein."),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps email_not_verified to a German message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "email_not_verified" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    renderLogin();
    await userEvent.type(screen.getByLabelText("E-Mail"), "ada@example.org");
    await userEvent.type(
      screen.getByLabelText("Passwort"),
      "irrelevant-password",
    );
    await userEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(
      await screen.findByText("Bitte bestätige zuerst deine E-Mail-Adresse."),
    ).toBeTruthy();
  });
});

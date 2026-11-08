import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/auth/AuthProvider";
import { session } from "@/auth/session";
import { LocationFormPage } from "./LocationFormPage";

const ID = "01a1b4ea-7b22-7679-af8a-a22acdbb9201";
const base = {
  id: ID,
  name: "Gebäude 21",
  kind: "customer_area",
  openingHours: [{ weekday: "mon", start: "07:30", end: "19:00" }],
  active: true,
  version: 1,
  updatedAt: "2026-11-08T08:00:00.000Z",
};
const res = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function mockApi(handlers: Record<string, () => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const key = `${init.method ?? "GET"} ${url}`;
      if (key === "GET /me") {
        return res(200, {
          id: "01a1b4ea-7b22-7679-af8a-a22acdbb9001",
          email: "anke@example.org",
          permissions: ["locations.manage"],
        });
      }
      const handler = handlers[key];
      if (!handler) throw new Error(`unexpected ${key}`);
      return handler();
    }),
  );
}

function renderAt(path: string) {
  session.setToken("token");
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/standorte/neu" element={<LocationFormPage />} />
            <Route
              path="/standorte/:id/bearbeiten"
              element={<LocationFormPage />}
            />
            <Route path="/standorte/:id" element={<p>Detailseite</p>} />
          </Routes>
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

describe("LocationFormPage", () => {
  it("shows a field error when the name is taken", async () => {
    mockApi({ "POST /locations": () => res(409, { error: "name_taken" }) });
    renderAt("/standorte/neu");
    await userEvent.type(await screen.findByLabelText("Name"), "Gebäude 21");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Diesen Namen gibt es schon.")).toBeTruthy();
  });

  it("on version conflict shows the alert and loads the current state on request", async () => {
    mockApi({
      [`GET /locations/${ID}`]: () => res(200, base),
      [`PUT /locations/${ID}`]: () =>
        res(409, {
          error: "version_conflict",
          current: { ...base, name: "Geb. 21 (neu)", version: 2 },
        }),
    });
    renderAt(`/standorte/${ID}/bearbeiten`);
    const name = (await screen.findByDisplayValue(
      "Gebäude 21",
    )) as HTMLInputElement;
    await userEvent.clear(name);
    await userEvent.type(name, "Meine Änderung");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText(
        "Der Standort wurde inzwischen von jemand anderem geändert",
      ),
    ).toBeTruthy();
    // own input is kept until the user explicitly loads the current state
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Meine Änderung",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Aktuellen Stand laden" }),
    );
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Geb. 21 (neu)",
    );
  });
});

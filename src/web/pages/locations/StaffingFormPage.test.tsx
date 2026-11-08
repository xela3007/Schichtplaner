import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/auth/AuthProvider";
import { session } from "@/auth/session";
import { StaffingFormPage } from "./StaffingFormPage";

const ID = "01a1b4ea-7b22-7679-af8a-a22acdbb9201";
const location = {
  id: ID,
  name: "Gebäude 21",
  kind: "customer_area",
  openingHours: [{ weekday: "mon", start: "07:30", end: "19:00" }],
  active: true,
  version: 1,
  updatedAt: "2026-11-08T08:00:00.000Z",
};
const stored = {
  windows: [{ weekday: "mon", start: "07:30", end: "19:00", people: 2 }],
  version: 1,
  updatedAt: "2026-11-08T08:00:00.000Z",
};
const res = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function mockApi(handlers: Record<string, () => Response>) {
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
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
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function renderPage() {
  session.setToken("token");
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AuthProvider>
        <MemoryRouter initialEntries={[`/standorte/${ID}/bedarf`]}>
          <Routes>
            <Route
              path="/standorte/:id/bedarf"
              element={<StaffingFormPage />}
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

describe("StaffingFormPage", () => {
  it("flags a window outside the opening hours and does not save", async () => {
    const fetch = mockApi({
      [`GET /locations/${ID}`]: () => res(200, location),
      [`GET /locations/${ID}/staffing`]: () => res(200, stored),
    });
    renderPage();
    const end = (await screen.findByLabelText(
      "Montag, Zeitfenster 1, Ende",
    )) as HTMLInputElement;
    await userEvent.clear(end);
    await userEvent.type(end, "20:00");
    expect(
      await screen.findByText(
        "Liegt außerhalb der Öffnungszeiten (07:30–19:00).",
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(
      false,
    );
    // closed days can't get demand
    expect(
      screen.getAllByText("geschlossen – kein Bedarf möglich"),
    ).toHaveLength(6);
  });

  it("on version conflict shows the alert and loads the current state on request", async () => {
    mockApi({
      [`GET /locations/${ID}`]: () => res(200, location),
      [`GET /locations/${ID}/staffing`]: () => res(200, stored),
      [`PUT /locations/${ID}/staffing`]: () =>
        res(409, {
          error: "version_conflict",
          current: {
            ...stored,
            windows: [{ ...stored.windows[0], people: 3 }],
            version: 2,
          },
        }),
    });
    renderPage();
    const people = (await screen.findByLabelText(
      "Montag, Zeitfenster 1, Personen",
    )) as HTMLInputElement;
    await userEvent.clear(people);
    await userEvent.type(people, "5");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText(
        "Der Besetzungsbedarf wurde inzwischen von jemand anderem geändert",
      ),
    ).toBeTruthy();
    expect(people.value).toBe("5");
    await userEvent.click(
      screen.getByRole("button", { name: "Aktuellen Stand laden" }),
    );
    expect(
      (
        screen.getByLabelText(
          "Montag, Zeitfenster 1, Personen",
        ) as HTMLInputElement
      ).value,
    ).toBe("3");
  });

  it("saves and returns to the detail page", async () => {
    mockApi({
      [`GET /locations/${ID}`]: () => res(200, location),
      [`GET /locations/${ID}/staffing`]: () =>
        res(200, { windows: [], version: 0, updatedAt: null }),
      [`PUT /locations/${ID}/staffing`]: () => res(200, stored),
    });
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Zeitfenster hinzufügen (Montag)",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Detailseite")).toBeTruthy();
  });
});

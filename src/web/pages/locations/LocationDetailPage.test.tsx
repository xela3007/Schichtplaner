import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/auth/AuthProvider";
import { session } from "@/auth/session";
import { LocationDetailPage } from "./LocationDetailPage";

const ID = "01a1ba68-3ba1-730f-b93a-57fda87ad0e5";
const location = {
  id: ID,
  name: "Gebäude 21",
  kind: "customer_area",
  openingHours: [{ weekday: "mon", start: "07:30", end: "19:00" }],
  active: true,
  version: 1,
  updatedAt: "2026-11-08T08:00:00.000Z",
};
const res = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

function setup(permissions: string[]) {
  const fetch = vi.fn(async (url: string) => {
    if (url === "/me")
      return res({
        id: "01a1b4ea-7b22-7679-af8a-a22acdbb9002",
        email: "m@example.org",
        permissions,
      });
    if (url === `/locations/${ID}`) return res(location);
    if (url === `/locations/${ID}/staffing`)
      return res({
        windows: [{ weekday: "mon", start: "07:30", end: "19:00", people: 2 }],
        version: 1,
        updatedAt: "2026-11-08T08:00:00.000Z",
      });
    if (url === `/locations/${ID}/history`) return res({ entries: [] });
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  session.setToken("token");
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AuthProvider>
        <MemoryRouter initialEntries={[`/standorte/${ID}`]}>
          <Routes>
            <Route path="/standorte/:id" element={<LocationDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return fetch;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  session.reset();
});

describe("LocationDetailPage – Besetzungsbedarf", () => {
  it("planners see the overview", async () => {
    setup(["locations.manage"]);
    expect(await screen.findByText("07:30–19:00 · 2 Personen")).toBeTruthy();
    expect(screen.getByText("Besetzungsbedarf")).toBeTruthy();
  });

  it("members see no staffing section and never request it", async () => {
    const fetch = setup([]);
    expect(await screen.findByText("Öffnungszeiten")).toBeTruthy();
    // /me has answered, so the decision is made on the real permissions
    await vi.waitFor(() =>
      expect(fetch.mock.calls.some(([url]) => url === "/me")).toBe(true),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Besetzungsbedarf")).toBeNull();
    expect(
      fetch.mock.calls.some(([url]) => String(url).endsWith("/staffing")),
    ).toBe(false);
  });
});

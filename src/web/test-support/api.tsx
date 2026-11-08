import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { vi } from "vitest";
import { AuthProvider } from "@/auth/AuthProvider";
import { session } from "@/auth/session";

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export type Handler = (init: RequestInit) => Response;

/** Stubs fetch; `/me` answers with the given permissions. Returns the mock. */
export function mockApi(
  handlers: Record<string, Handler | Response>,
  permissions = ["locations.manage", "employees.manage"],
) {
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${url}`;
    if (key === "GET /me") {
      return json(200, {
        id: "01a1b4ea-7b22-7679-af8a-a22acdbb9001",
        email: "anke@example.org",
        permissions,
      });
    }
    const h = handlers[key];
    if (!h) throw new Error(`unexpected ${key}`);
    return typeof h === "function" ? h(init) : h.clone();
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

export function renderRoutes(
  path: string,
  routes: Record<string, React.ReactNode>,
) {
  session.setToken("token");
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            {Object.entries(routes).map(([p, el]) => (
              <Route key={p} path={p} element={el} />
            ))}
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

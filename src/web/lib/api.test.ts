import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeResponse } from "#shared/auth.js";
import { session } from "@/auth/session";
import { ApiError, apiFetch } from "./api";

const ME = {
  id: "01a1b4ea-7b22-7679-af8a-a22acdbb9467",
  email: "a@b.de",
  permissions: [],
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("apiFetch with expired access token", () => {
  let refreshCalls = 0;

  beforeEach(() => {
    refreshCalls = 0;
    session.setToken("expired");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    session.reset();
  });

  it("3 parallel 401s trigger exactly ONE refresh and all retries succeed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init: RequestInit) => {
        if (input === "/auth/refresh") {
          refreshCalls++;
          await new Promise((r) => setTimeout(r, 10));
          return json(200, { accessToken: "fresh", expiresIn: 900 });
        }
        const auth = (init.headers as Record<string, string>).Authorization;
        return auth === "Bearer fresh"
          ? json(200, ME)
          : json(401, { error: "unauthorized" });
      }),
    );

    const results = await Promise.all(
      [1, 2, 3].map(() => apiFetch("/me", { schema: MeResponse, auth: true })),
    );
    expect(refreshCalls).toBe(1);
    expect(results).toEqual([ME, ME, ME]);
    expect(session.get()).toEqual({ status: "authenticated", token: "fresh" });
  });

  it("clears the session when the refresh fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) =>
        input === "/auth/refresh"
          ? json(401, { error: "unauthorized" })
          : json(401, { error: "unauthorized" }),
      ),
    );
    await expect(
      apiFetch("/me", { schema: MeResponse, auth: true }),
    ).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    });
    expect(session.get().status).toBe("anonymous");
  });

  it("maps network failures to ApiError(0, network_error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("offline"))),
    );
    const error = await apiFetch("/health").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: "network_error" });
  });
});

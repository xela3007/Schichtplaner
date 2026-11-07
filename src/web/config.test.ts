import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config";

describe("resolveConfig", () => {
  it("prefers the runtime config.js value", () => {
    expect(
      resolveConfig({ API_BASE_URL: "https://api.example.org/" }, "http://env"),
    ).toEqual({
      ok: true,
      config: { API_BASE_URL: "https://api.example.org" },
    });
  });

  it("falls back to import.meta.env and to same origin", () => {
    expect(resolveConfig({}, "http://localhost:3000")).toMatchObject({
      config: { API_BASE_URL: "http://localhost:3000" },
    });
    expect(resolveConfig(undefined, undefined)).toMatchObject({
      config: { API_BASE_URL: "" },
    });
  });

  it("rejects an invalid URL with a readable message", () => {
    const result = resolveConfig({ API_BASE_URL: "not a url" }, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("API_BASE_URL");
  });
});

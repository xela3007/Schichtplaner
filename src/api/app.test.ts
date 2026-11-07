import { describe, expect, it } from "vitest";
import { HealthResponse } from "#shared/health.js";
import { makeTestApp } from "./test-support/fakes.js";

function makeApp(databaseOk = true) {
  return makeTestApp({ databaseOk }).app;
}

const app = makeApp();

describe("GET /health", () => {
  it("returns 200 with a schema-valid body and a request id", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body).toMatchObject({
      status: "ok",
      version: "1.2.3",
      commit: "abc123",
    });
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("echoes an incoming X-Request-Id", async () => {
    const res = await app.request("/health", {
      headers: { "X-Request-Id": "req-42" },
    });
    expect(res.headers.get("X-Request-Id")).toBe("req-42");
  });
});

describe("GET /health with database down", () => {
  it("returns 503 degraded with a schema-valid body", async () => {
    const res = await makeApp(false).request("/health");
    expect(res.status).toBe(503);
    const body = HealthResponse.parse(await res.json());
    expect(body).toMatchObject({
      status: "degraded",
      checks: { database: "error" },
    });
  });
});

describe("unknown route", () => {
  it("returns 404 JSON with request id", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "not_found",
      requestId: res.headers.get("X-Request-Id"),
    });
  });
});

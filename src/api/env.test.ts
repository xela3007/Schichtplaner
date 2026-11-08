import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env.js";

const DB = "postgresql://user:pw-SECRET@host-pooler/neondb?sslmode=require";
const JWT = "j".repeat(32);
const BASE = { DATABASE_URL: DB, JWT_SECRET: JWT };

function errorOf(fn: () => unknown): EnvError {
  try {
    fn();
  } catch (e) {
    if (e instanceof EnvError) return e;
    throw e;
  }
  throw new Error("expected EnvError");
}

describe("parseEnv", () => {
  it("applies defaults", () => {
    expect(parseEnv(BASE)).toEqual({
      NODE_ENV: "development",
      PORT: 3000,
      LOG_LEVEL: "info",
      DATABASE_URL: DB,
      JWT_SECRET: JWT,
      WEB_APP_URL: "http://localhost:5173",
      TRUST_PROXY: false,
      PLANNER_EMAILS: [],
      CORS_ORIGINS: [],
      COOKIE_SAMESITE: "lax",
      HOST: "::",
    });
  });

  it("falls back to RAILWAY_GIT_COMMIT_SHA", () => {
    expect(
      parseEnv({ ...BASE, RAILWAY_GIT_COMMIT_SHA: "abc123" }).GIT_COMMIT_SHA,
    ).toBe("abc123");
  });

  it("names every invalid variable", () => {
    const error = errorOf(() =>
      parseEnv({ ...BASE, PORT: "abc", LOG_LEVEL: "loud" }),
    );
    const variables = error.issues.map((i) => i.variable);
    expect(variables).toEqual(expect.arrayContaining(["PORT", "LOG_LEVEL"]));
    expect(error.message).toContain("PORT");
  });

  it("requires DATABASE_URL", () => {
    const error = errorOf(() => parseEnv({}));
    expect(error.issues.map((i) => i.variable)).toContain("DATABASE_URL");
  });

  it("rejects non-postgres URLs without echoing the value", () => {
    const error = errorOf(() =>
      parseEnv({
        JWT_SECRET: JWT,
        DATABASE_URL: "mysql://user:pw-SECRET@host/db",
      }),
    );
    expect(error.issues.map((i) => i.variable)).toContain("DATABASE_URL");
    expect(error.message).not.toContain("pw-SECRET");
  });

  it("requires a JWT_SECRET of at least 32 characters and parses TRUST_PROXY", () => {
    const error = errorOf(() =>
      parseEnv({ DATABASE_URL: DB, JWT_SECRET: "short" }),
    );
    expect(error.issues.map((i) => i.variable)).toContain("JWT_SECRET");
    expect(error.message).not.toContain("short");
    expect(parseEnv({ ...BASE, TRUST_PROXY: "true" }).TRUST_PROXY).toBe(true);
  });

  it("parses CORS_ORIGINS as a URL list and rejects garbage", () => {
    expect(
      parseEnv({
        ...BASE,
        CORS_ORIGINS: "https://a.example, https://b.example",
      }).CORS_ORIGINS,
    ).toEqual(["https://a.example", "https://b.example"]);
    const error = errorOf(() =>
      parseEnv({ ...BASE, CORS_ORIGINS: "not-a-url" }),
    );
    expect(error.issues.map((i) => i.variable)).toContain("CORS_ORIGINS");
    const sameSite = errorOf(() =>
      parseEnv({ ...BASE, COOKIE_SAMESITE: "strict" }),
    );
    expect(sameSite.issues.map((i) => i.variable)).toContain("COOKIE_SAMESITE");
  });

  it("parses PLANNER_EMAILS lowercased and rejects non-emails", () => {
    expect(
      parseEnv({
        ...BASE,
        PLANNER_EMAILS: " Anke@Example.org, bob@example.org ",
      }).PLANNER_EMAILS,
    ).toEqual(["anke@example.org", "bob@example.org"]);
    const error = errorOf(() =>
      parseEnv({ ...BASE, PLANNER_EMAILS: "not-an-email" }),
    );
    expect(error.issues.map((i) => i.variable)).toContain("PLANNER_EMAILS");
  });
});

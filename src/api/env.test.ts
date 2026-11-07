import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env.js";

const DB = "postgresql://user:pw-SECRET@host-pooler/neondb?sslmode=require";

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
    expect(parseEnv({ DATABASE_URL: DB })).toEqual({
      NODE_ENV: "development",
      PORT: 3000,
      LOG_LEVEL: "info",
      DATABASE_URL: DB,
    });
  });

  it("falls back to RAILWAY_GIT_COMMIT_SHA", () => {
    expect(
      parseEnv({ DATABASE_URL: DB, RAILWAY_GIT_COMMIT_SHA: "abc123" })
        .GIT_COMMIT_SHA,
    ).toBe("abc123");
  });

  it("names every invalid variable", () => {
    const error = errorOf(() =>
      parseEnv({ DATABASE_URL: DB, PORT: "abc", LOG_LEVEL: "loud" }),
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
      parseEnv({ DATABASE_URL: "mysql://user:pw-SECRET@host/db" }),
    );
    expect(error.issues.map((i) => i.variable)).toContain("DATABASE_URL");
    expect(error.message).not.toContain("pw-SECRET");
  });
});

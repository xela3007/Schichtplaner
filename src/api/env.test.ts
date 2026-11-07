import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env.js";

describe("parseEnv", () => {
  it("applies defaults", () => {
    expect(parseEnv({})).toEqual({
      NODE_ENV: "development",
      PORT: 3000,
      LOG_LEVEL: "info",
    });
  });

  it("falls back to RAILWAY_GIT_COMMIT_SHA", () => {
    expect(parseEnv({ RAILWAY_GIT_COMMIT_SHA: "abc123" }).GIT_COMMIT_SHA).toBe(
      "abc123",
    );
  });

  it("names every invalid variable", () => {
    let error: unknown;
    try {
      parseEnv({ PORT: "abc", LOG_LEVEL: "loud" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EnvError);
    const variables = (error as EnvError).issues.map((i) => i.variable);
    expect(variables).toEqual(expect.arrayContaining(["PORT", "LOG_LEVEL"]));
    expect((error as EnvError).message).toContain("PORT");
  });
});

import { describe, expect, it } from "vitest";
import { signAccessToken } from "../auth/tokens.js";
import { makeTestApp, TEST_SECRET } from "../test-support/fakes.js";

const sub = "01a1b4ea-7b22-7679-af8a-a22acdbb9467";
const bearer = async (permissions: string[]) => ({
  Authorization: `Bearer ${await signAccessToken({ sub, permissions }, TEST_SECRET)}`,
});

describe("GET /reference", () => {
  const { app } = makeTestApp();

  it("401 without a token", async () => {
    expect((await app.request("/reference")).status).toBe(401);
  });

  it("401 with an invalid token", async () => {
    const res = await app.request("/reference", {
      headers: { Authorization: "Bearer nope" },
    });
    expect(res.status).toBe(401);
  });

  it("403 without reference.read", async () => {
    const res = await app.request("/reference", {
      headers: await bearer(["other.thing"]),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden" });
  });

  it("200 with reference.read", async () => {
    const res = await app.request("/reference", {
      headers: await bearer(["reference.read"]),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

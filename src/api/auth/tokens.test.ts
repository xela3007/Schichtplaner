import { describe, expect, it } from "vitest";
import { TEST_SECRET } from "../test-support/fakes.js";
import {
  hashToken,
  newOpaqueToken,
  signAccessToken,
  verifyAccessToken,
} from "./tokens.js";

const sub = "01a1b4ea-7b22-7679-af8a-a22acdbb9467";

describe("access tokens", () => {
  it("carries permissions, not roles", async () => {
    const token = await signAccessToken(
      { sub, permissions: ["reference.read"] },
      TEST_SECRET,
    );
    expect(await verifyAccessToken(token, TEST_SECRET)).toEqual({
      sub,
      permissions: ["reference.read"],
    });
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
    );
    expect(payload).not.toHaveProperty("roles");
    expect(payload.exp - payload.iat).toBe(900);
  });

  it("rejects a wrong secret, a tampered token and an expired token", async () => {
    const token = await signAccessToken({ sub, permissions: [] }, TEST_SECRET);
    expect(await verifyAccessToken(token, `${TEST_SECRET}x`)).toBeNull();
    expect(await verifyAccessToken(`${token}x`, TEST_SECRET)).toBeNull();
    const old = await signAccessToken(
      { sub, permissions: [] },
      TEST_SECRET,
      new Date(0),
    );
    expect(await verifyAccessToken(old, TEST_SECRET)).toBeNull();
  });
});

describe("opaque tokens", () => {
  it("are random and hashed deterministically", () => {
    const a = newOpaqueToken();
    expect(a).not.toBe(newOpaqueToken());
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

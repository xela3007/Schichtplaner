import { describe, expect, it } from "vitest";
import { getDummyHash, hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("round-trips with Argon2id", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery")).toBe(true);
    expect(await verifyPassword(hash, "wrong password!!")).toBe(false);
  });

  it("returns false for a malformed hash instead of throwing", async () => {
    expect(await verifyPassword("not-a-hash", "whatever")).toBe(false);
  });

  it("provides a reusable dummy hash", async () => {
    expect(await getDummyHash()).toBe(await getDummyHash());
  });
});

import { describe, expect, it } from "vitest";
import { TokenResponse } from "#shared/auth.js";
import { hashPassword } from "../auth/password.js";
import { makeTestApp } from "../test-support/fakes.js";

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const EMAIL = "Ada@Example.org";
const PASSWORD = "a-long-enough-password";

function cookieValue(res: Response): string | undefined {
  return res.headers.get("set-cookie")?.match(/rt=([^;]*)/)?.[1];
}

/** The mail links to the frontend page; the page calls this API route with the token. */
function verifyPath(link: string): string {
  const token = new URL(link).searchParams.get("token") ?? "";
  return `/auth/verify-email?token=${encodeURIComponent(token)}`;
}

async function signupAndVerify(ctx: ReturnType<typeof makeTestApp>) {
  await ctx.app.request(
    "/auth/signup",
    json({ email: EMAIL, password: PASSWORD }),
  );
  const link = ctx.mailer.sent.at(-1)?.link ?? "";
  return ctx.app.request(verifyPath(link));
}

async function login(ctx: ReturnType<typeof makeTestApp>) {
  return ctx.app.request(
    "/auth/login",
    json({ email: EMAIL, password: PASSWORD }),
  );
}

describe("signup", () => {
  it("returns 202, stores lowercased email, mails a verification link", async () => {
    const ctx = makeTestApp();
    const res = await ctx.app.request(
      "/auth/signup",
      json({ email: EMAIL, password: PASSWORD }),
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "pending_verification" });
    expect(
      await ctx.repository.findUserByEmail("ada@example.org"),
    ).not.toBeNull();
    expect(ctx.mailer.sent).toHaveLength(1);
    expect(ctx.mailer.sent[0]?.link).toMatch(
      /^http:\/\/web\.test\/verify-email\?token=/,
    );
  });

  it("answers identically for an existing email and sends no mail", async () => {
    const ctx = makeTestApp();
    await ctx.app.request(
      "/auth/signup",
      json({ email: EMAIL, password: PASSWORD }),
    );
    const res = await ctx.app.request(
      "/auth/signup",
      json({ email: EMAIL, password: PASSWORD }),
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "pending_verification" });
    expect(ctx.mailer.sent).toHaveLength(1);
  });

  it("rejects short passwords and invalid JSON with 400", async () => {
    const ctx = makeTestApp();
    const short = await ctx.app.request(
      "/auth/signup",
      json({ email: EMAIL, password: "short" }),
    );
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ error: "validation_failed" });
    const broken = await ctx.app.request("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(broken.status).toBe(400);
  });

  it("rate-limits after 5 attempts per IP with 429 + Retry-After", async () => {
    const ctx = makeTestApp();
    for (let i = 0; i < 5; i++) {
      const r = await ctx.app.request(
        "/auth/signup",
        json({ email: `u${i}@example.org`, password: PASSWORD }),
      );
      expect(r.status).toBe(202);
    }
    const res = await ctx.app.request(
      "/auth/signup",
      json({ email: "u6@example.org", password: PASSWORD }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });
});

describe("verify-email", () => {
  it("verifies once; reuse and unknown tokens are 400", async () => {
    const ctx = makeTestApp();
    const first = await signupAndVerify(ctx);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: "verified" });

    const link = ctx.mailer.sent[0]?.link ?? "";
    expect((await ctx.app.request(verifyPath(link))).status).toBe(400);
    expect(
      (await ctx.app.request("/auth/verify-email?token=unknown")).status,
    ).toBe(400);
    expect((await ctx.app.request("/auth/verify-email")).status).toBe(400);
  });
});

describe("login", () => {
  it("403 email_not_verified before verification (only with correct password)", async () => {
    const ctx = makeTestApp();
    await ctx.app.request(
      "/auth/signup",
      json({ email: EMAIL, password: PASSWORD }),
    );
    const res = await login(ctx);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "email_not_verified" });
    const wrong = await ctx.app.request(
      "/auth/login",
      json({ email: EMAIL, password: "nope-nope" }),
    );
    expect(wrong.status).toBe(401);
  });

  it("401 invalid_credentials for unknown email and wrong password", async () => {
    const ctx = makeTestApp();
    await signupAndVerify(ctx);
    const unknown = await ctx.app.request(
      "/auth/login",
      json({ email: "ghost@example.org", password: PASSWORD }),
    );
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toMatchObject({
      error: "invalid_credentials",
    });
    const wrong = await ctx.app.request(
      "/auth/login",
      json({ email: EMAIL, password: "wrong-pass" }),
    );
    expect(wrong.status).toBe(401);
  });

  it("200 with access token + refresh cookie after verification", async () => {
    const ctx = makeTestApp();
    await signupAndVerify(ctx);
    const res = await login(ctx);
    expect(res.status).toBe(200);
    const body = TokenResponse.parse(await res.json());
    expect(body.expiresIn).toBe(900);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/rt=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it("rate-limits per IP + email after 10 attempts", async () => {
    const ctx = makeTestApp();
    for (let i = 0; i < 10; i++) {
      expect((await login(ctx)).status).toBe(401);
    }
    expect((await login(ctx)).status).toBe(429);
  });
});

describe("me", () => {
  it("returns the user with permissions from the token", async () => {
    const ctx = makeTestApp();
    await signupAndVerify(ctx);
    const { accessToken } = TokenResponse.parse(
      await (await login(ctx)).json(),
    );
    const res = await ctx.app.request("/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      email: "ada@example.org",
      permissions: [],
    });
    expect((await ctx.app.request("/me")).status).toBe(401);
  });
});

describe("refresh / logout", () => {
  it("rotates the refresh token", async () => {
    const ctx = makeTestApp();
    await signupAndVerify(ctx);
    const first = cookieValue(await login(ctx));
    const res = await ctx.app.request("/auth/refresh", {
      method: "POST",
      headers: { Cookie: `rt=${first}` },
    });
    expect(res.status).toBe(200);
    TokenResponse.parse(await res.json());
    const second = cookieValue(res);
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it("reuse of a rotated token revokes all sessions of the user", async () => {
    const ctx = makeTestApp();
    await signupAndVerify(ctx);
    const first = cookieValue(await login(ctx));
    const rotated = await ctx.app.request("/auth/refresh", {
      method: "POST",
      headers: { Cookie: `rt=${first}` },
    });
    const second = cookieValue(rotated);

    const reuse = await ctx.app.request("/auth/refresh", {
      method: "POST",
      headers: { Cookie: `rt=${first}` },
    });
    expect(reuse.status).toBe(401);
    // the legitimately rotated token is now revoked as well
    const after = await ctx.app.request("/auth/refresh", {
      method: "POST",
      headers: { Cookie: `rt=${second}` },
    });
    expect(after.status).toBe(401);
    expect(
      [...ctx.repository.refreshTokens.values()].every((t) => t.revokedAt),
    ).toBe(true);
  });

  it("401 + cleared cookie without or with unknown cookie", async () => {
    const ctx = makeTestApp();
    const none = await ctx.app.request("/auth/refresh", { method: "POST" });
    expect(none.status).toBe(401);
    expect(none.headers.get("set-cookie")).toMatch(/rt=;.*Max-Age=0/);
    const unknown = await ctx.app.request("/auth/refresh", {
      method: "POST",
      headers: { Cookie: "rt=bogus" },
    });
    expect(unknown.status).toBe(401);
  });

  it("logout revokes the token and clears the cookie", async () => {
    const ctx = makeTestApp();
    await signupAndVerify(ctx);
    const token = cookieValue(await login(ctx));
    const out = await ctx.app.request("/auth/logout", {
      method: "POST",
      headers: { Cookie: `rt=${token}` },
    });
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toMatch(/rt=;.*Max-Age=0/);
    const res = await ctx.app.request("/auth/refresh", {
      method: "POST",
      headers: { Cookie: `rt=${token}` },
    });
    expect(res.status).toBe(401);
  });
});

describe("cookie attributes per environment", () => {
  it("production: SameSite=None + Secure on set and on clear", async () => {
    const ctx = makeTestApp({ secureCookies: true });
    const user = {
      id: "01a1b4ea-7b22-7679-af8a-a22acdbb9467",
      email: "ada@example.org",
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: new Date(),
    };
    ctx.repository.users.set(user.id, user);
    const set = (await login(ctx)).headers.get("set-cookie") ?? "";
    const cleared =
      (await ctx.app.request("/auth/logout", { method: "POST" })).headers.get(
        "set-cookie",
      ) ?? "";
    for (const header of [set, cleared]) {
      expect(header).toMatch(/SameSite=None/);
      expect(header).toMatch(/Secure/);
      expect(header).toMatch(/HttpOnly/);
      expect(header).toMatch(/Path=\/auth/);
    }
  });
});

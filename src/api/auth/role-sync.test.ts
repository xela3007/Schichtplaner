import { describe, expect, it } from "vitest";
import { makeTestApp, TEST_SECRET } from "../test-support/fakes.js";
import { hashPassword } from "./password.js";
import { verifyAccessToken } from "./tokens.js";

const PW = "a-long-enough-password";

async function setup(plannerEmails: string[]) {
  const ctx = makeTestApp({ plannerEmails });
  const user = {
    id: "01a1b4ea-7b22-7679-af8a-a22acdbb9101",
    email: "anke@example.org",
    passwordHash: await hashPassword(PW),
    emailVerifiedAt: new Date(),
  };
  ctx.repository.users.set(user.id, user);
  return { ctx, user };
}

async function loginPermissions(ctx: ReturnType<typeof makeTestApp>) {
  const res = await ctx.app.request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "anke@example.org", password: PW }),
  });
  const { accessToken } = (await res.json()) as { accessToken: string };
  return {
    claims: await verifyAccessToken(accessToken, TEST_SECRET),
    cookie: res.headers.get("set-cookie") ?? "",
  };
}

describe("planner role from PLANNER_EMAILS", () => {
  it("listed user gets locations.manage at login", async () => {
    const { ctx } = await setup(["anke@example.org"]);
    const { claims } = await loginPermissions(ctx);
    expect(claims?.permissions).toContain("locations.manage");
  });

  it("unlisted user does not, and loses an existing role at the next refresh", async () => {
    const { ctx, user } = await setup([]);
    ctx.repository.userRoleKeys.set(user.id, new Set(["planner"]));
    const { claims, cookie } = await loginPermissions(ctx);
    expect(claims?.permissions).not.toContain("locations.manage");

    // Also on refresh: the role stays revoked.
    const rt = cookie.match(/rt=([^;]*)/)?.[1];
    const res = await ctx.app.request("/auth/refresh", {
      method: "POST",
      headers: { Cookie: `rt=${rt}` },
    });
    const { accessToken } = (await res.json()) as { accessToken: string };
    expect(
      (await verifyAccessToken(accessToken, TEST_SECRET))?.permissions,
    ).not.toContain("locations.manage");
  });
});

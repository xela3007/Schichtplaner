import { type Context, Hono } from "hono";
import { LoginRequest, SignupRequest, TokenResponse } from "#shared/auth.js";
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from "../auth/cookies.js";
import {
  type AuthService,
  RateLimitedError,
  type Session,
} from "../auth/service.js";
import type { AppEnv } from "../types.js";
import { parseJson } from "../validation.js";

export type AuthRouteDeps = {
  service: AuthService;
  secureCookies: boolean;
  clientIp: (c: Context) => string;
};

export function authRoutes({
  service,
  secureCookies,
  clientIp,
}: AuthRouteDeps) {
  const app = new Hono<AppEnv>();

  const tokenBody = (session: Session) =>
    TokenResponse.parse({
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
    });

  app.onError((error, c) => {
    if (error instanceof RateLimitedError) {
      c.header("Retry-After", String(error.retryAfterSec));
      return c.json(
        { error: "rate_limited", requestId: c.get("requestId") },
        429,
      );
    }
    throw error;
  });

  app.post("/signup", async (c) => {
    const parsed = await parseJson(c, SignupRequest);
    if ("response" in parsed) return parsed.response;
    await service.signup(parsed.data.email, parsed.data.password, clientIp(c));
    return c.json({ status: "pending_verification" }, 202);
  });

  app.get("/verify-email", async (c) => {
    const token = c.req.query("token");
    if (!token || !(await service.verifyEmail(token))) {
      return c.json(
        { error: "invalid_token", requestId: c.get("requestId") },
        400,
      );
    }
    return c.json({ status: "verified" }, 200);
  });

  app.post("/login", async (c) => {
    const parsed = await parseJson(c, LoginRequest);
    if ("response" in parsed) return parsed.response;
    const result = await service.login(
      parsed.data.email,
      parsed.data.password,
      clientIp(c),
    );
    if (result.kind === "invalid_credentials") {
      return c.json(
        { error: "invalid_credentials", requestId: c.get("requestId") },
        401,
      );
    }
    if (result.kind === "email_not_verified") {
      return c.json(
        { error: "email_not_verified", requestId: c.get("requestId") },
        403,
      );
    }
    setRefreshCookie(c, result.session.refreshToken, secureCookies);
    return c.json(tokenBody(result.session), 200);
  });

  app.post("/refresh", async (c) => {
    const result = await service.refresh(readRefreshCookie(c));
    if (result.kind === "unauthorized") {
      clearRefreshCookie(c, secureCookies);
      return c.json(
        { error: "unauthorized", requestId: c.get("requestId") },
        401,
      );
    }
    setRefreshCookie(c, result.session.refreshToken, secureCookies);
    return c.json(tokenBody(result.session), 200);
  });

  app.post("/logout", async (c) => {
    await service.logout(readRefreshCookie(c));
    clearRefreshCookie(c, secureCookies);
    return c.body(null, 204);
  });

  return app;
}

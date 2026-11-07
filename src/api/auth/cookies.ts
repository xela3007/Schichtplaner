import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import { REFRESH_TOKEN_TTL_SECONDS } from "./tokens.js";

export const REFRESH_COOKIE = "rt";

export type CookiePolicy = { secure: boolean; sameSite: "Lax" | "None" };

/** Production behind the same-origin web container (ADR-014) vs. local dev. */
export function cookiePolicy(
  production: boolean,
  sameSite: "lax" | "none",
): CookiePolicy {
  // SameSite=None is only valid together with Secure.
  return sameSite === "none"
    ? { secure: true, sameSite: "None" }
    : { secure: production, sameSite: "Lax" };
}

/**
 * ADR-005: set and clear MUST share these attributes, otherwise the browser
 * ignores the deletion.
 */
export function refreshCookieOptions(policy: CookiePolicy): CookieOptions {
  return {
    httpOnly: true,
    path: "/auth",
    secure: policy.secure,
    sameSite: policy.sameSite,
  };
}

export function setRefreshCookie(
  c: Context,
  token: string,
  policy: CookiePolicy,
) {
  setCookie(c, REFRESH_COOKIE, token, {
    ...refreshCookieOptions(policy),
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
  });
}

export function clearRefreshCookie(c: Context, policy: CookiePolicy) {
  deleteCookie(c, REFRESH_COOKIE, refreshCookieOptions(policy));
}

export function readRefreshCookie(c: Context): string | undefined {
  return getCookie(c, REFRESH_COOKIE);
}

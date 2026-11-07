import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import { REFRESH_TOKEN_TTL_SECONDS } from "./tokens.js";

export const REFRESH_COOKIE = "rt";

/**
 * ADR-005: SameSite=None + Secure in production (frontend and API on separate
 * domains), Lax locally. Set and clear MUST share these attributes, otherwise
 * the browser ignores the deletion.
 */
export function refreshCookieOptions(secure: boolean): CookieOptions {
  return secure
    ? { httpOnly: true, path: "/auth", secure: true, sameSite: "None" }
    : { httpOnly: true, path: "/auth", secure: false, sameSite: "Lax" };
}

export function setRefreshCookie(c: Context, token: string, secure: boolean) {
  setCookie(c, REFRESH_COOKIE, token, {
    ...refreshCookieOptions(secure),
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
  });
}

export function clearRefreshCookie(c: Context, secure: boolean) {
  deleteCookie(c, REFRESH_COOKIE, refreshCookieOptions(secure));
}

export function readRefreshCookie(c: Context): string | undefined {
  return getCookie(c, REFRESH_COOKIE);
}

import type { z } from "zod";
import { ErrorResponse, TokenResponse } from "#shared/auth.js";
import { session } from "@/auth/session";
import { configResult } from "@/config";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** Parsed error body, e.g. `current` for a version_conflict. */
    readonly body: unknown = null,
  ) {
    super(`${status} ${code}`);
    this.name = "ApiError";
  }
}

type Options<T extends z.ZodType> = {
  schema?: T;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Send the access token and refresh once on 401. */
  auth?: boolean;
  /** Non-2xx statuses whose body is still valid data (e.g. 503 from /health). */
  acceptStatus?: readonly number[];
};

let baseUrlOverride: string | undefined;
/** Test helper. */
export function setApiBaseUrl(url: string | undefined) {
  baseUrlOverride = url;
}

function url(path: string) {
  const base =
    baseUrlOverride ??
    (configResult.ok ? configResult.config.API_BASE_URL : "");
  return `${base}${path}`;
}

async function send(
  path: string,
  method: string,
  body: unknown,
  token: string | null,
) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetch(url(path), {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network_error");
  }
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * ADR-007: parallel 401s share ONE refresh request. A second refresh with the
 * same (already rotated) cookie would trigger the API's reuse detection and
 * revoke every session of the user.
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await send("/auth/refresh", "POST", undefined, null);
      if (!res.ok) {
        session.clear();
        return false;
      }
      session.setToken(TokenResponse.parse(await res.json()).accessToken);
      return true;
    } catch {
      session.clear();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function toError(res: Response): Promise<ApiError> {
  const raw: unknown = await res.json().catch(() => null);
  const parsed = ErrorResponse.safeParse(raw);
  return new ApiError(
    res.status,
    parsed.success ? parsed.data.error : "unknown_error",
    raw,
  );
}

export async function apiFetch<T extends z.ZodType = z.ZodUnknown>(
  path: string,
  {
    schema,
    method = "GET",
    body,
    auth = false,
    acceptStatus = [],
  }: Options<T> = {},
): Promise<z.infer<T>> {
  let res = await send(path, method, body, auth ? session.token() : null);

  if (auth && res.status === 401 && (await refreshSession())) {
    res = await send(path, method, body, session.token());
  }

  if (!res.ok && !acceptStatus.includes(res.status)) throw await toError(res);
  if (res.status === 204 || !schema) return undefined as z.infer<T>;
  return schema.parse(await res.json());
}

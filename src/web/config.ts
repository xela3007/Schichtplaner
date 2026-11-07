import { z } from "zod";

/** One schema for both sources: runtime config.js and import.meta.env (ADR-007). */
export const WebConfig = z.object({
  // "" = same origin (local dev through the Vite proxy)
  API_BASE_URL: z.union([
    z.literal(""),
    z.url({ error: "must be a URL or empty" }),
  ]),
});
export type WebConfig = z.infer<typeof WebConfig>;

export type ConfigResult =
  | { ok: true; config: WebConfig }
  | { ok: false; message: string };

/** Pure: runtime config wins when it carries the key, otherwise the build-time env. */
export function resolveConfig(
  runtime: Record<string, unknown> | undefined,
  envApiBaseUrl: string | undefined,
): ConfigResult {
  const raw =
    runtime && "API_BASE_URL" in runtime
      ? { API_BASE_URL: runtime.API_BASE_URL }
      : { API_BASE_URL: envApiBaseUrl ?? "" };
  const result = WebConfig.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      message: result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }
  const config = { API_BASE_URL: result.data.API_BASE_URL.replace(/\/+$/, "") };
  return { ok: true, config };
}

export const configResult = resolveConfig(
  typeof window === "undefined" ? undefined : window.__APP_CONFIG__,
  import.meta.env.VITE_API_BASE_URL,
);

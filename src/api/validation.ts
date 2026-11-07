import type { Context } from "hono";
import type { z } from "zod";

/** Parses the JSON body with a Zod schema; returns data or a ready 400 response. */
export async function parseJson<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<{ data: z.infer<T> } | { response: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return {
      response: c.json(
        { error: "invalid_json", requestId: c.get("requestId") },
        400,
      ),
    };
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      response: c.json(
        {
          error: "validation_failed",
          requestId: c.get("requestId"),
          issues: result.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        },
        400,
      ),
    };
  }
  return { data: result.data };
}

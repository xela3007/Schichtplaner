import { signAccessToken } from "../auth/tokens.js";
import { TEST_SECRET } from "./fakes.js";

export const PLANNER_ID = "01a1b4ea-7b22-7679-af8a-a22acdbb9001";
export const MEMBER_ID = "01a1b4ea-7b22-7679-af8a-a22acdbb9002";

export async function bearer(sub: string, permissions: string[]) {
  return {
    Authorization: `Bearer ${await signAccessToken({ sub, permissions }, TEST_SECRET)}`,
  };
}
export const plannerAuth = () =>
  bearer(PLANNER_ID, [
    "locations.manage",
    "employees.manage",
    "availability.manage",
  ]);
export const memberAuth = () => bearer(MEMBER_ID, []);

/** Small request helper around app.request with JSON bodies. */
export function client(app: {
  request: (path: string, init?: RequestInit) => Response | Promise<Response>;
}) {
  return async (
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => {
    const res = await app.request(path, {
      method,
      headers: {
        ...(headers ?? (await plannerAuth())),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

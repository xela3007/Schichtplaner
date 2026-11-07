import { Hono } from "hono";
import { MeResponse } from "#shared/auth.js";
import type { AuthService } from "../auth/service.js";
import type { AppEnv } from "../types.js";

export function meRoutes(service: AuthService) {
  return new Hono<AppEnv>().get("/me", async (c) => {
    const auth = c.get("auth");
    const user = await service.me(auth.userId);
    if (!user)
      return c.json(
        { error: "unauthorized", requestId: c.get("requestId") },
        401,
      );
    return c.json(
      MeResponse.parse({
        id: user.id,
        email: user.email,
        permissions: auth.permissions,
      }),
      200,
    );
  });
}

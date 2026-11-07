import { createHash, randomBytes } from "node:crypto";
import { sign, verify } from "hono/jwt";
import { z } from "zod";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const VERIFICATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const ISSUER = "schichtplaner";

const AccessClaims = z.object({
  sub: z.uuid(),
  permissions: z.array(z.string()),
  iss: z.literal(ISSUER),
  exp: z.number(),
});

export async function signAccessToken(
  claims: { sub: string; permissions: readonly string[] },
  secret: string,
  now = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return sign(
    {
      sub: claims.sub,
      permissions: [...claims.permissions],
      iss: ISSUER,
      iat,
      exp: iat + ACCESS_TOKEN_TTL_SECONDS,
    },
    secret,
    "HS256",
  );
}

/** Returns the claims or null — never throws. */
export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<{ sub: string; permissions: string[] } | null> {
  try {
    const payload = AccessClaims.parse(await verify(token, secret, "HS256"));
    return { sub: payload.sub, permissions: payload.permissions };
  } catch {
    return null;
  }
}

/** Opaque random token (refresh / verification). Only its hash is stored. */
export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

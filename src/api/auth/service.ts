import type { Logger } from "pino";
import { v7 as uuidv7 } from "uuid";
import type { Mailer } from "../mail/mailer.js";
import { getDummyHash, hashPassword, verifyPassword } from "./password.js";
import type { RateLimiter } from "./rate-limit.js";
import type { AuthRepository } from "./repository.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  hashToken,
  newOpaqueToken,
  REFRESH_TOKEN_TTL_SECONDS,
  signAccessToken,
  VERIFICATION_TOKEN_TTL_SECONDS,
} from "./tokens.js";

export const LIMITS = {
  signup: { limit: 5, windowSec: 60 * 60 },
  login: { limit: 10, windowSec: 15 * 60 },
} as const;

export type AuthConfig = { jwtSecret: string; publicApiUrl: string };

export type Session = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
};

export type LoginResult =
  | { kind: "ok"; session: Session }
  | { kind: "invalid_credentials" }
  | { kind: "email_not_verified" };

export type RefreshResult =
  | { kind: "ok"; session: Session }
  | { kind: "unauthorized" };

export class RateLimitedError extends Error {
  constructor(readonly retryAfterSec: number) {
    super("rate limited");
  }
}

export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly limiter: RateLimiter,
    private readonly mailer: Mailer,
    private readonly config: AuthConfig,
    private readonly log: Logger,
  ) {}

  private async limit(key: string, rule: { limit: number; windowSec: number }) {
    const result = await this.limiter.hit(key, rule.limit, rule.windowSec);
    if (!result.allowed) throw new RateLimitedError(result.retryAfterSec);
  }

  async signup(email: string, password: string, ip: string): Promise<void> {
    await this.limit(`signup:${ip}`, LIMITS.signup);

    const existing = await this.repo.findUserByEmail(email);
    if (existing) {
      // Same response as a new sign-up — no account enumeration (ADR-005).
      this.log.info(
        { userId: existing.id },
        "signup for existing account ignored",
      );
      return;
    }

    const userId = uuidv7();
    const token = newOpaqueToken();
    await this.repo.createUserWithVerification({
      userId,
      email,
      passwordHash: await hashPassword(password),
      verification: {
        id: uuidv7(),
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_SECONDS * 1000),
      },
    });

    const link = `${this.config.publicApiUrl}/auth/verify-email?token=${encodeURIComponent(token)}`;
    await this.mailer.send({
      to: email,
      subject: "Bitte bestätige deine E-Mail-Adresse",
      text: `Bestätige deine Adresse mit diesem Link (24 Stunden gültig):\n${link}`,
      link,
    });
    this.log.info({ userId }, "user signed up");
  }

  async verifyEmail(token: string): Promise<boolean> {
    const result = await this.repo.consumeVerificationToken(hashToken(token));
    if (result) this.log.info({ userId: result.userId }, "email verified");
    return result !== null;
  }

  async login(
    email: string,
    password: string,
    ip: string,
  ): Promise<LoginResult> {
    await this.limit(`login:${ip}:${email}`, LIMITS.login);

    const user = await this.repo.findUserByEmail(email);
    const passwordOk = await verifyPassword(
      user?.passwordHash ?? (await getDummyHash()),
      password,
    );
    if (!user || !passwordOk) return { kind: "invalid_credentials" };
    if (!user.emailVerifiedAt) return { kind: "email_not_verified" };

    const refreshToken = newOpaqueToken();
    await this.repo.insertRefreshToken({
      id: uuidv7(),
      userId: user.id,
      familyId: uuidv7(),
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    });
    this.log.info({ userId: user.id }, "user logged in");
    return { kind: "ok", session: await this.session(user.id, refreshToken) };
  }

  async refresh(refreshToken: string | undefined): Promise<RefreshResult> {
    if (!refreshToken) return { kind: "unauthorized" };
    const current = await this.repo.findRefreshToken(hashToken(refreshToken));
    if (!current) return { kind: "unauthorized" };

    if (current.revokedAt) {
      if (current.replacedBy) await this.reuseDetected(current.userId);
      return { kind: "unauthorized" };
    }
    if (current.expiresAt.getTime() <= Date.now())
      return { kind: "unauthorized" };

    const next = newOpaqueToken();
    const rotated = await this.repo.rotateRefreshToken(current.id, {
      id: uuidv7(),
      tokenHash: hashToken(next),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    });
    if (!rotated) {
      // Lost a race against a parallel refresh with the same token → treat as reuse.
      await this.reuseDetected(current.userId);
      return { kind: "unauthorized" };
    }
    return { kind: "ok", session: await this.session(current.userId, next) };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken)
      await this.repo.revokeRefreshToken(hashToken(refreshToken));
  }

  async me(userId: string) {
    return this.repo.findUserById(userId);
  }

  private async reuseDetected(userId: string) {
    await this.repo.revokeAllForUser(userId);
    this.log.warn(
      { userId },
      "refresh token reuse detected — all sessions revoked",
    );
  }

  private async session(
    userId: string,
    refreshToken: string,
  ): Promise<Session> {
    const permissions = await this.repo.getPermissions(userId);
    return {
      accessToken: await signAccessToken(
        { sub: userId, permissions },
        this.config.jwtSecret,
      ),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
    };
  }
}

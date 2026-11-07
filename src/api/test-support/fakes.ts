// In-memory stand-ins for tests — no database in CI (ADR-012).
import { pino } from "pino";
import { createApp } from "../app.js";
import type { CookiePolicy } from "../auth/cookies.js";
import type { RateLimiter } from "../auth/rate-limit.js";
import type {
  AuthRepository,
  NewRefreshToken,
  NewUser,
  RefreshTokenRecord,
  UserRecord,
} from "../auth/repository.js";
import type { Mail, Mailer } from "../mail/mailer.js";

export const TEST_SECRET = "test-secret-that-is-long-enough-1234567890";

export class InMemoryAuthRepository implements AuthRepository {
  users = new Map<string, UserRecord>();
  userPermissions = new Map<string, string[]>();
  verifications = new Map<
    string,
    { userId: string; expiresAt: Date; usedAt: Date | null }
  >();
  refreshTokens = new Map<string, RefreshTokenRecord & { tokenHash: string }>();

  async findUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async findUserById(id: string) {
    return this.users.get(id) ?? null;
  }
  async createUserWithVerification(user: NewUser) {
    this.users.set(user.userId, {
      id: user.userId,
      email: user.email,
      passwordHash: user.passwordHash,
      emailVerifiedAt: null,
    });
    this.userPermissions.set(user.userId, []); // default role "member": no permissions
    this.verifications.set(user.verification.tokenHash, {
      userId: user.userId,
      expiresAt: user.verification.expiresAt,
      usedAt: null,
    });
  }
  async consumeVerificationToken(tokenHash: string) {
    const v = this.verifications.get(tokenHash);
    if (!v || v.usedAt || v.expiresAt.getTime() <= Date.now()) return null;
    v.usedAt = new Date();
    const user = this.users.get(v.userId);
    if (user) user.emailVerifiedAt ??= new Date();
    return { userId: v.userId };
  }
  async getPermissions(userId: string) {
    return [...(this.userPermissions.get(userId) ?? [])].sort();
  }
  async insertRefreshToken(t: NewRefreshToken) {
    this.refreshTokens.set(t.id, { ...t, revokedAt: null, replacedBy: null });
  }
  async findRefreshToken(tokenHash: string) {
    return (
      [...this.refreshTokens.values()].find((t) => t.tokenHash === tokenHash) ??
      null
    );
  }
  async rotateRefreshToken(
    oldId: string,
    next: Omit<NewRefreshToken, "userId" | "familyId">,
  ) {
    const old = this.refreshTokens.get(oldId);
    if (!old || old.revokedAt || old.expiresAt.getTime() <= Date.now())
      return false;
    old.revokedAt = new Date();
    old.replacedBy = next.id;
    this.refreshTokens.set(next.id, {
      ...next,
      userId: old.userId,
      familyId: old.familyId,
      revokedAt: null,
      replacedBy: null,
    });
    return true;
  }
  async revokeRefreshToken(tokenHash: string) {
    const t = await this.findRefreshToken(tokenHash);
    if (t && !t.revokedAt) t.revokedAt = new Date();
  }
  async revokeAllForUser(userId: string) {
    for (const t of this.refreshTokens.values()) {
      if (t.userId === userId && !t.revokedAt) t.revokedAt = new Date();
    }
  }
}

export class InMemoryRateLimiter implements RateLimiter {
  counts = new Map<string, number>();
  async hit(key: string, limit: number) {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return { allowed: count <= limit, retryAfterSec: 60 };
  }
}

export class CapturingMailer implements Mailer {
  readonly kind = "console" as const;
  sent: Mail[] = [];
  async send(mail: Mail) {
    this.sent.push(mail);
  }
}

export function makeTestApp(
  opts: {
    databaseOk?: boolean;
    cookiePolicy?: CookiePolicy;
    corsOrigins?: string[];
  } = {},
) {
  const repository = new InMemoryAuthRepository();
  const rateLimiter = new InMemoryRateLimiter();
  const mailer = new CapturingMailer();
  const app = createApp({
    logger: pino({ level: "silent" }),
    buildInfo: { version: "1.2.3", commit: "abc123", startedAt: new Date() },
    checkDatabase: async () => opts.databaseOk ?? true,
    auth: {
      repository,
      rateLimiter,
      mailer,
      jwtSecret: TEST_SECRET,
      webAppUrl: "http://web.test",
      cookiePolicy: opts.cookiePolicy ?? { secure: false, sameSite: "Lax" },
      corsOrigins: opts.corsOrigins ?? [],
      clientIp: () => "203.0.113.7",
    },
  });
  return { app, repository, rateLimiter, mailer };
}

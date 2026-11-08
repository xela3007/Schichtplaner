// In-memory stand-ins for tests — no database in CI (ADR-012).

import { pino } from "pino";
import { v7 as uuidv7 } from "uuid";
import type { AuditEntry, Location, LocationInput } from "#shared/locations.js";
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
import { diffLocation, normalizeHours } from "../locations/diff.js";
import type {
  LocationRepository,
  WriteResult,
} from "../locations/repository.js";
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
  /** role key → permissions, mirrors the seeded roles */
  rolePermissions: Record<string, string[]> = { planner: ["locations.manage"] };
  userRoleKeys = new Map<string, Set<string>>();

  async getPermissions(userId: string) {
    const fromRoles = [...(this.userRoleKeys.get(userId) ?? [])].flatMap(
      (k) => this.rolePermissions[k] ?? [],
    );
    return [
      ...new Set([...(this.userPermissions.get(userId) ?? []), ...fromRoles]),
    ].sort();
  }
  async syncRole(userId: string, roleKey: string, shouldHave: boolean) {
    const keys = this.userRoleKeys.get(userId) ?? new Set<string>();
    this.userRoleKeys.set(userId, keys);
    const had = keys.has(roleKey);
    if (shouldHave) keys.add(roleKey);
    else keys.delete(roleKey);
    return had !== shouldHave;
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

export class InMemoryLocationRepository implements LocationRepository {
  rows = new Map<string, Location>();
  audit: (AuditEntry & { entityId: string; actorId: string })[] = [];
  private tick = 0;

  private nameTaken(name: string, exceptId?: string) {
    return [...this.rows.values()].some(
      (l) => l.id !== exceptId && l.name.toLowerCase() === name.toLowerCase(),
    );
  }
  private log(
    entityId: string,
    action: AuditEntry["action"],
    actorId: string,
    changes: AuditEntry["changes"],
  ) {
    this.audit.push({
      id: uuidv7(),
      entityId,
      action,
      actorId,
      actorEmail: `${actorId}@example.org`,
      occurredAt: new Date(Date.now() + this.tick++).toISOString(),
      changes,
    });
  }

  async list({ includeInactive }: { includeInactive: boolean }) {
    return [...this.rows.values()]
      .filter((l) => includeInactive || l.active)
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async create(input: LocationInput, actorId: string): Promise<WriteResult> {
    if (this.nameTaken(input.name)) return { kind: "name_taken" };
    const location: Location = {
      id: uuidv7(),
      ...input,
      openingHours: normalizeHours(input.openingHours),
      active: true,
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(location.id, location);
    this.log(location.id, "created", actorId, diffLocation(null, location));
    return { kind: "ok", location };
  }
  async update(
    id: string,
    input: LocationInput,
    version: number,
    actorId: string,
  ): Promise<WriteResult> {
    const current = this.rows.get(id);
    if (!current) return { kind: "not_found" };
    if (current.version !== version) return { kind: "conflict", current };
    if (this.nameTaken(input.name, id)) return { kind: "name_taken" };
    const next = {
      ...current,
      ...input,
      openingHours: normalizeHours(input.openingHours),
      version: version + 1,
    };
    this.rows.set(id, next);
    this.log(id, "updated", actorId, diffLocation(current, next));
    return { kind: "ok", location: next };
  }
  async setActive(
    id: string,
    active: boolean,
    version: number,
    actorId: string,
  ): Promise<WriteResult> {
    const current = this.rows.get(id);
    if (!current) return { kind: "not_found" };
    if (current.version !== version) return { kind: "conflict", current };
    const next = { ...current, active, version: version + 1 };
    this.rows.set(id, next);
    this.log(id, active ? "reactivated" : "deactivated", actorId, {
      active: { from: current.active, to: active },
    });
    return { kind: "ok", location: next };
  }
  async history(id: string) {
    return this.audit
      .filter((e) => e.entityId === id)
      .reverse()
      .map(({ entityId: _e, actorId: _a, ...entry }) => entry);
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
    plannerEmails?: string[];
  } = {},
) {
  const repository = new InMemoryAuthRepository();
  const rateLimiter = new InMemoryRateLimiter();
  const mailer = new CapturingMailer();
  const locations = new InMemoryLocationRepository();
  const app = createApp({
    logger: pino({ level: "silent" }),
    buildInfo: { version: "1.2.3", commit: "abc123", startedAt: new Date() },
    checkDatabase: async () => opts.databaseOk ?? true,
    locations,
    auth: {
      repository,
      rateLimiter,
      mailer,
      jwtSecret: TEST_SECRET,
      webAppUrl: "http://web.test",
      cookiePolicy: opts.cookiePolicy ?? { secure: false, sameSite: "Lax" },
      corsOrigins: opts.corsOrigins ?? [],
      plannerEmails: opts.plannerEmails ?? [],
      clientIp: () => "203.0.113.7",
    },
  });
  return { app, repository, rateLimiter, mailer, locations };
}

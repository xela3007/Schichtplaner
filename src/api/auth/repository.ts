import { and, eq, isNull, sql } from "drizzle-orm";
import {
  emailVerificationTokens,
  permissions,
  refreshTokens,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "#shared/db/schema.js";
import type { Db } from "../db/client.js";

export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
};

export type RefreshTokenRecord = {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
};

export type NewUser = {
  userId: string;
  email: string;
  passwordHash: string;
  verification: { id: string; tokenHash: string; expiresAt: Date };
};

export type NewRefreshToken = {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
};

/** All auth persistence goes through here (ADR-004: no SQL in endpoints). */
export interface AuthRepository {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  /** User + default role + verification token, atomically. */
  createUserWithVerification(user: NewUser): Promise<void>;
  /** Marks the token used and the user verified in one statement; null if unusable. */
  consumeVerificationToken(
    tokenHash: string,
  ): Promise<{ userId: string } | null>;
  getPermissions(userId: string): Promise<string[]>;
  /** Grants or revokes a role by key; returns true if something changed. */
  syncRole(
    userId: string,
    roleKey: string,
    shouldHave: boolean,
  ): Promise<boolean>;
  insertRefreshToken(token: NewRefreshToken): Promise<void>;
  findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /** Revokes `oldId` and inserts its successor atomically; false if `oldId` was no longer active. */
  rotateRefreshToken(
    oldId: string,
    next: Omit<NewRefreshToken, "userId" | "familyId">,
  ): Promise<boolean>;
  revokeRefreshToken(tokenHash: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
}

export class DrizzleAuthRepository implements AuthRepository {
  constructor(private readonly db: Db) {}

  async findUserByEmail(email: string) {
    const [row] = await this.db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.email, email));
    return row ?? null;
  }

  async findUserById(id: string) {
    const [row] = await this.db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.id, id));
    return row ?? null;
  }

  async createUserWithVerification(user: NewUser) {
    const [defaultRole] = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.isDefault, true));
    if (!defaultRole) throw new Error("no default role configured");

    // neon-http has no transactions (ADR-004) — batch runs all-or-nothing.
    await this.db.batch([
      this.db.insert(users).values({
        id: user.userId,
        email: user.email,
        passwordHash: user.passwordHash,
      }),
      this.db
        .insert(userRoles)
        .values({ userId: user.userId, roleId: defaultRole.id }),
      this.db.insert(emailVerificationTokens).values({
        id: user.verification.id,
        userId: user.userId,
        tokenHash: user.verification.tokenHash,
        expiresAt: user.verification.expiresAt,
      }),
    ]);
  }

  async consumeVerificationToken(tokenHash: string) {
    const result = await this.db.execute<{ id: string }>(sql`
      with consumed as (
        update ${emailVerificationTokens}
        set used_at = now(), updated_at = now()
        where token_hash = ${tokenHash} and used_at is null and expires_at > now()
        returning user_id
      )
      update ${users}
      set email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
      from consumed
      where ${users.id} = consumed.user_id
      returning ${users.id} as id
    `);
    const row = result.rows[0];
    return row ? { userId: row.id } : null;
  }

  async getPermissions(userId: string) {
    const rows = await this.db
      .selectDistinct({ key: permissions.key })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(userRoles.userId, userId));
    return rows.map((r) => r.key).sort();
  }

  async syncRole(userId: string, roleKey: string, shouldHave: boolean) {
    const result = shouldHave
      ? await this.db.execute(sql`
          insert into ${userRoles} (user_id, role_id)
          select ${userId}, ${roles.id} from ${roles} where ${roles.key} = ${roleKey}
          on conflict do nothing
          returning user_id
        `)
      : await this.db.execute(sql`
          delete from ${userRoles}
          where user_id = ${userId}
            and role_id = (select ${roles.id} from ${roles} where ${roles.key} = ${roleKey})
          returning user_id
        `);
    return result.rows.length > 0;
  }

  async insertRefreshToken(token: NewRefreshToken) {
    await this.db.insert(refreshTokens).values(token);
  }

  async findRefreshToken(tokenHash: string) {
    const [row] = await this.db
      .select({
        id: refreshTokens.id,
        userId: refreshTokens.userId,
        familyId: refreshTokens.familyId,
        expiresAt: refreshTokens.expiresAt,
        revokedAt: refreshTokens.revokedAt,
        replacedBy: refreshTokens.replacedBy,
      })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash));
    return row ?? null;
  }

  async rotateRefreshToken(
    oldId: string,
    next: Omit<NewRefreshToken, "userId" | "familyId">,
  ) {
    // One statement: only an active token can be rotated, so two parallel
    // refreshes with the same cookie cannot both succeed.
    const result = await this.db.execute<{ id: string }>(sql`
      with old as (
        update ${refreshTokens}
        set revoked_at = now(), replaced_by = ${next.id}, updated_at = now()
        where id = ${oldId} and revoked_at is null and expires_at > now()
        returning user_id, family_id
      )
      insert into ${refreshTokens} (id, user_id, family_id, token_hash, expires_at)
      select ${next.id}, user_id, family_id, ${next.tokenHash}, ${next.expiresAt.toISOString()}
      from old
      returning id
    `);
    return result.rows.length === 1;
  }

  async revokeRefreshToken(tokenHash: string) {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }

  async revokeAllForUser(userId: string) {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)),
      );
  }
}

import { desc, eq, sql } from "drizzle-orm";
import { auditEvents, users } from "#shared/db/schema.js";
import type { AuditAction, AuditEntry } from "#shared/locations.js";
import type { Db } from "../db/client.js";

export type Changes = Record<string, { from: unknown; to: unknown }>;

/** Audit entries of one entity, newest first (ADR-015). */
export async function historyFor(
  db: Db,
  entityType: string,
  entityId: string,
): Promise<AuditEntry[]> {
  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      actorEmail: users.email,
      occurredAt: auditEvents.occurredAt,
      changes: auditEvents.changes,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(
      sql`${auditEvents.entityType} = ${entityType} and ${auditEvents.entityId} = ${entityId}`,
    )
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id));
  return rows.map((r) => ({
    id: r.id,
    action: r.action as AuditAction,
    actorEmail: r.actorEmail ?? null,
    occurredAt: r.occurredAt.toISOString(),
    changes: r.changes,
  }));
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const e = error as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  const code = e.code ?? e.cause?.code;
  const name = e.constraint ?? e.cause?.constraint;
  return code === "23505" && (!name || name === constraint);
}

/** Field diff of plain values (arrays compared as JSON). */
export function diffFields<T extends Record<string, unknown>>(
  before: T | null,
  after: T,
  fields: (keyof T)[],
): Changes {
  const changes: Changes = {};
  for (const f of fields) {
    const from = before ? (before[f] ?? null) : null;
    const to = after[f] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to))
      changes[f as string] = { from, to };
  }
  return changes;
}

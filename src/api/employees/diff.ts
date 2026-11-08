import type { Employee, EmployeeInput } from "#shared/employees.js";
import type { Changes } from "../audit/history.js";

export const PII_FIELDS = ["mobile", "email"] as const;
const PLAIN = [
  "firstName",
  "lastName",
  "personnelNo",
  "contractTypeId",
  "weeklyMinutesOverride",
  "isFloater",
  "note",
  "qualificationIds",
  "systemAccessIds",
] as const;

type Comparable = Omit<EmployeeInput, never> & { active?: boolean };

const locMap = (l: EmployeeInput["locations"]) =>
  Object.fromEntries(
    [...l]
      .sort((a, b) => a.locationId.localeCompare(b.locationId))
      .map((x) => [
        x.locationId,
        `${x.trained ? "trained" : "untrained"}/${x.preference}`,
      ]),
  );

/**
 * Field diff for the audit log (ADR-015). Phone and e-mail are PII: only the
 * fact that they changed is recorded — `{from: null, to: null}` (ADR-013).
 */
export function diffEmployee(
  before: Comparable | Employee | null,
  after: Comparable,
): Changes {
  const changes: Changes = {};
  for (const f of PLAIN) {
    const from = before ? (before[f] ?? null) : null;
    const to = after[f] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[f] = { from, to };
  }
  for (const f of PII_FIELDS) {
    if ((before?.[f] ?? null) !== (after[f] ?? null))
      changes[f] = { from: null, to: null };
  }
  const fromLoc = before ? locMap(before.locations) : {};
  const toLoc = locMap(after.locations);
  if (JSON.stringify(fromLoc) !== JSON.stringify(toLoc))
    changes.locations = { from: before ? fromLoc : null, to: toLoc };
  return changes;
}

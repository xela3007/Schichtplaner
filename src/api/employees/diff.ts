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
  "locationMode",
  "note",
  "qualificationIds",
  "systemAccessIds",
] as const;

type Comparable = Omit<EmployeeInput, never> & { active?: boolean };

const locMap = (l: readonly Employee["locations"][number][]) =>
  Object.fromEntries(
    [...l]
      .sort((a, b) => a.locationId.localeCompare(b.locationId))
      .map((x) => [
        x.locationId,
        `${x.trained ? "trained" : "untrained"}/${x.preference}${x.released ? "/released" : ""}`,
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
    // profiles from before dc6c6578 have no locationMode → the default
    const dflt = f === "locationMode" ? "all_except_blocked" : null;
    const from = before ? (before[f] ?? dflt) : null;
    const to = after[f] ?? dflt;
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

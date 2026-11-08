import type { LocationInput } from "#shared/locations.js";

export type Changes = Record<string, { from: unknown; to: unknown }>;

type Comparable = Pick<LocationInput, "name" | "kind" | "openingHours"> & {
  active?: boolean;
};

/** Normalizes opening hours so reordering alone isn't reported as a change. */
export function normalizeHours(hours: LocationInput["openingHours"]) {
  const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  return [...hours]
    .map(({ weekday, start, end }) => ({ weekday, start, end }))
    .sort(
      (a, b) =>
        order.indexOf(a.weekday) - order.indexOf(b.weekday) ||
        a.start.localeCompare(b.start),
    );
}

/** Field-level diff for the audit log (ADR-015). Opening hours as a whole value. */
export function diffLocation(
  before: Comparable | null,
  after: Comparable,
): Changes {
  const changes: Changes = {};
  const b = before ?? {
    name: undefined,
    kind: undefined,
    openingHours: undefined,
    active: undefined,
  };
  if (b.name !== after.name)
    changes.name = { from: b.name ?? null, to: after.name };
  if (b.kind !== after.kind)
    changes.kind = { from: b.kind ?? null, to: after.kind };
  const fromHours = b.openingHours ? normalizeHours(b.openingHours) : null;
  const toHours = normalizeHours(after.openingHours);
  if (JSON.stringify(fromHours) !== JSON.stringify(toHours)) {
    changes.openingHours = { from: fromHours, to: toHours };
  }
  if (after.active !== undefined && b.active !== after.active) {
    changes.active = { from: b.active ?? null, to: after.active };
  }
  return changes;
}

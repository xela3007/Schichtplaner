import type { AuditEntry } from "#shared/locations.js";

export const AUDIT_ACTION_LABELS: Record<AuditEntry["action"], string> = {
  created: "angelegt",
  updated: "geändert",
  deactivated: "deaktiviert",
  reactivated: "reaktiviert",
  absence_added: "Abwesenheit hinzugefügt",
  absence_changed: "Abwesenheit geändert",
  absence_deleted: "Abwesenheit gelöscht",
  rule_added: "Regel hinzugefügt",
  rule_changed: "Regel geändert",
  rule_deleted: "Regel gelöscht",
  assigned: "eingeteilt",
  unassigned: "ausgeteilt",
};

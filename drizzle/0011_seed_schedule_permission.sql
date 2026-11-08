-- 0011_seed_schedule_permission: permission schedule.manage (ADR-010) for the
-- role "planner". Existing planners get it at their next login/refresh.
-- Fixed UUID v7 literal — IDs come from the application, never from the DB.
INSERT INTO "permissions" ("id", "key", "description") VALUES
  ('01a1bba5-9c2a-73aa-985f-a3412e461911', 'schedule.manage', 'View and maintain the shift plan (assign and remove employees)');
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") VALUES
  ('01a1ba61-3987-7335-b191-45b842820e6d', '01a1bba5-9c2a-73aa-985f-a3412e461911');

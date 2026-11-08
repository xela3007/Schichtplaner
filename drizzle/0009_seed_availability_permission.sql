-- 0009_seed_availability_permission: permission availability.manage (ADR-010)
-- for the role "planner". Existing planners get it at their next login/refresh.
-- Fixed UUID v7 literal — IDs come from the application, never from the DB.
INSERT INTO "permissions" ("id", "key", "description") VALUES
  ('01a1bb74-a284-76d4-af35-ff7ae1531288', 'availability.manage', 'Maintain absences and availability rules, read employee profiles');
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") VALUES
  ('01a1ba61-3987-7335-b191-45b842820e6d', '01a1bb74-a284-76d4-af35-ff7ae1531288');

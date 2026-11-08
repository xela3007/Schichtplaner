-- 0004_seed_planner: role "planner" (Planerin) with permission locations.manage
-- (ADR-010). Assigned at login/refresh from PLANNER_EMAILS — no emails here.
-- Fixed UUID v7 literals — IDs come from the application, never from the DB.
INSERT INTO "permissions" ("id", "key", "description") VALUES
  ('01a1ba61-3985-76f6-998c-c1277b0bf83e', 'locations.manage', 'Create, edit, deactivate locations and read their history');
--> statement-breakpoint
INSERT INTO "roles" ("id", "key", "name", "is_default") VALUES
  ('01a1ba61-3987-7335-b191-45b842820e6d', 'planner', 'Planerin', false);
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") VALUES
  ('01a1ba61-3987-7335-b191-45b842820e6d', '01a1ba61-3985-76f6-998c-c1277b0bf83e');

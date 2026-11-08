-- 0007_seed_employees_permission: permission employees.manage (ADR-010) for the
-- role "planner". Existing planners get it at their next login/refresh (role sync).
-- Fixed UUID v7 literal — IDs come from the application, never from the DB.
INSERT INTO "permissions" ("id", "key", "description") VALUES
  ('01a1bb3f-920d-75a1-9403-16e4086d8a1a', 'employees.manage', 'Manage employee profiles, contract types, qualifications and system accesses, and read their history');
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") VALUES
  ('01a1ba61-3987-7335-b191-45b842820e6d', '01a1bb3f-920d-75a1-9403-16e4086d8a1a');

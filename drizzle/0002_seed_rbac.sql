-- 0002_seed_rbac: reference RBAC data (ADR-010). Structural, not a domain model.
-- Fixed UUID v7 literals — IDs come from the application, never from the DB.
--   member            default role for new sign-ups, deliberately no permissions
--   reference-reader  holds reference.read (used by GET /reference)
INSERT INTO "permissions" ("id", "key", "description") VALUES
  ('01a1b4ea-7b22-7679-af8a-a22acdbb9467', 'reference.read', 'Read the protected reference route');
--> statement-breakpoint
INSERT INTO "roles" ("id", "key", "name", "is_default") VALUES
  ('01a1b4ea-7b24-7775-bf51-9bfe95e7d2ea', 'member', 'Member', true),
  ('01a1b4ea-7b24-7775-bf51-9dd34388389a', 'reference-reader', 'Reference reader', false);
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id") VALUES
  ('01a1b4ea-7b24-7775-bf51-9dd34388389a', '01a1b4ea-7b22-7679-af8a-a22acdbb9467');

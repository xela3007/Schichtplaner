ALTER TABLE "employees" ALTER COLUMN "mobile" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_locations" ADD COLUMN "released" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "location_mode" text DEFAULT 'all_except_blocked' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_location_mode_check" CHECK ("employees"."location_mode" in ('all_except_blocked', 'only_selected'));
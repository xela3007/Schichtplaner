CREATE TABLE "shift_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"location_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"shift_start" text NOT NULL,
	"shift_end" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_assignments_time_check" CHECK ("shift_assignments"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "shift_assignments"."end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "shift_assignments"."start_time" < "shift_assignments"."end_time")
);
--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_assignments_date_location_idx" ON "shift_assignments" USING btree ("date","location_id");--> statement-breakpoint
CREATE INDEX "shift_assignments_employee_date_idx" ON "shift_assignments" USING btree ("employee_id","date");--> statement-breakpoint
-- Hand-written (drizzle-kit can't express exclusion constraints): one person can't
-- be in two places at once. Half-open minute ranges, so touching times are allowed.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_no_overlap" EXCLUDE USING gist (
  "employee_id" WITH =,
  "date" WITH =,
  int4range(
    split_part("start_time", ':', 1)::int * 60 + split_part("start_time", ':', 2)::int,
    split_part("end_time", ':', 1)::int * 60 + split_part("end_time", ':', 2)::int
  ) WITH &&
);

CREATE TABLE "schedule_copies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_start" date NOT NULL,
	"target_starts" jsonb NOT NULL,
	"location_ids" jsonb NOT NULL,
	"copied" integer NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD COLUMN "copy_id" uuid;--> statement-breakpoint
ALTER TABLE "schedule_copies" ADD CONSTRAINT "schedule_copies_undone_by_users_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_copies" ADD CONSTRAINT "schedule_copies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_copies_created_idx" ON "schedule_copies" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_copy_id_schedule_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."schedule_copies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_assignments_copy_idx" ON "shift_assignments" USING btree ("copy_id");
CREATE TABLE "shift_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"location_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"base_start" text,
	"base_end" text,
	"start_time" text,
	"end_time" text,
	"people" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_overrides_kind_check" CHECK ("shift_overrides"."kind" in ('added', 'changed', 'cancelled')),
	CONSTRAINT "shift_overrides_shape_check" CHECK (("shift_overrides"."kind" = 'added' and "shift_overrides"."start_time" is not null and "shift_overrides"."end_time" is not null and "shift_overrides"."people" is not null and "shift_overrides"."base_start" is null and "shift_overrides"."base_end" is null)
        or ("shift_overrides"."kind" = 'changed' and "shift_overrides"."start_time" is not null and "shift_overrides"."end_time" is not null and "shift_overrides"."people" is not null and "shift_overrides"."base_start" is not null and "shift_overrides"."base_end" is not null)
        or ("shift_overrides"."kind" = 'cancelled' and "shift_overrides"."start_time" is null and "shift_overrides"."end_time" is null and "shift_overrides"."people" is null and "shift_overrides"."base_start" is not null and "shift_overrides"."base_end" is not null)),
	CONSTRAINT "shift_overrides_values_check" CHECK (("shift_overrides"."start_time" is null or "shift_overrides"."start_time" < "shift_overrides"."end_time") and ("shift_overrides"."base_start" is null or "shift_overrides"."base_start" < "shift_overrides"."base_end") and ("shift_overrides"."people" is null or "shift_overrides"."people" between 1 and 20))
);
--> statement-breakpoint
ALTER TABLE "shift_overrides" ADD CONSTRAINT "shift_overrides_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_overrides" ADD CONSTRAINT "shift_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_overrides_location_date_idx" ON "shift_overrides" USING btree ("location_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_overrides_base_unique_idx" ON "shift_overrides" USING btree ("location_id","date","base_start","base_end") WHERE "shift_overrides"."kind" <> 'added';
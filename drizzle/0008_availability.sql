CREATE TABLE "absences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"start_time" text,
	"end_time" text,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "absences_kind_check" CHECK ("absences"."kind" in ('vacation', 'absent', 'appointment', 'wish_off')),
	CONSTRAINT "absences_range_check" CHECK ("absences"."end_date" >= "absences"."start_date"),
	CONSTRAINT "absences_time_check" CHECK (("absences"."start_time" is null and "absences"."end_time" is null) or ("absences"."start_time" is not null and "absences"."end_time" is not null and "absences"."start_date" = "absences"."end_date" and "absences"."start_time" < "absences"."end_time"))
);
--> statement-breakpoint
CREATE TABLE "availability_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"weekdays" text[] NOT NULL,
	"start_time" text,
	"end_time" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_rules_weekdays_check" CHECK (cardinality("availability_rules"."weekdays") between 1 and 7 and "availability_rules"."weekdays" <@ array['mon','tue','wed','thu','fri','sat','sun']::text[]),
	CONSTRAINT "availability_rules_time_check" CHECK ("availability_rules"."start_time" is null or "availability_rules"."end_time" is null or "availability_rules"."start_time" < "availability_rules"."end_time")
);
--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absences_employee_idx" ON "absences" USING btree ("employee_id","start_date");--> statement-breakpoint
CREATE INDEX "absences_range_idx" ON "absences" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "availability_rules_employee_idx" ON "availability_rules" USING btree ("employee_id");
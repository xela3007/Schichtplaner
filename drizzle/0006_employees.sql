CREATE TABLE "contract_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"weekly_minutes" integer NOT NULL,
	"typical_shift_minutes" integer,
	"allowed_shift_minutes" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"max_daily_minutes" integer,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_locations" (
	"employee_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"trained" boolean NOT NULL,
	"preference" text NOT NULL,
	CONSTRAINT "employee_locations_employee_id_location_id_pk" PRIMARY KEY("employee_id","location_id"),
	CONSTRAINT "employee_locations_preference_check" CHECK ("employee_locations"."preference" in ('preferred', 'neutral', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "employee_qualifications" (
	"employee_id" uuid NOT NULL,
	"qualification_id" uuid NOT NULL,
	CONSTRAINT "employee_qualifications_employee_id_qualification_id_pk" PRIMARY KEY("employee_id","qualification_id")
);
--> statement-breakpoint
CREATE TABLE "employee_system_accesses" (
	"employee_id" uuid NOT NULL,
	"system_access_id" uuid NOT NULL,
	CONSTRAINT "employee_system_accesses_employee_id_system_access_id_pk" PRIMARY KEY("employee_id","system_access_id")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"personnel_no" text,
	"mobile" text NOT NULL,
	"email" text,
	"contract_type_id" uuid NOT NULL,
	"weekly_minutes_override" integer,
	"is_floater" boolean DEFAULT false NOT NULL,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_accesses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_locations" ADD CONSTRAINT "employee_locations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_locations" ADD CONSTRAINT "employee_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_qualifications" ADD CONSTRAINT "employee_qualifications_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_qualifications" ADD CONSTRAINT "employee_qualifications_qualification_id_qualifications_id_fk" FOREIGN KEY ("qualification_id") REFERENCES "public"."qualifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_system_accesses" ADD CONSTRAINT "employee_system_accesses_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_system_accesses" ADD CONSTRAINT "employee_system_accesses_system_access_id_system_accesses_id_fk" FOREIGN KEY ("system_access_id") REFERENCES "public"."system_accesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_contract_type_id_contract_types_id_fk" FOREIGN KEY ("contract_type_id") REFERENCES "public"."contract_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_types_name_lower_idx" ON "contract_types" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "employees_name_idx" ON "employees" USING btree ("last_name","first_name");--> statement-breakpoint
CREATE INDEX "employees_contract_type_idx" ON "employees" USING btree ("contract_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qualifications_name_lower_idx" ON "qualifications" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "system_accesses_name_lower_idx" ON "system_accesses" USING btree (lower("name"));
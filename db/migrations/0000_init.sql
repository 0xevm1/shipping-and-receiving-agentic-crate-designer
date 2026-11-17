CREATE TABLE "artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"configuration_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"object_key" text NOT NULL,
	"built_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_configuration_kind_key" UNIQUE("org_id","configuration_id","kind"),
	CONSTRAINT "artifact_kind_check" CHECK ("artifact"."kind" in ('glb', 'pdf', 'csv', 'zip')),
	CONSTRAINT "artifact_built_by_check" CHECK ("artifact"."built_by" in ('browser', 'server'))
);
--> statement-breakpoint
CREATE TABLE "configuration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"quantity_per_crate" integer NOT NULL,
	"layout" text NOT NULL,
	"settings" jsonb NOT NULL,
	"result_summary" jsonb,
	"score" double precision,
	"origin" text NOT NULL,
	"engine_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "configuration_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "configuration_org_id_input_hash_key" UNIQUE("org_id","input_hash"),
	CONSTRAINT "configuration_origin_check" CHECK ("configuration"."origin" in ('precomputed', 'user')),
	CONSTRAINT "configuration_quantity_positive" CHECK ("configuration"."quantity_per_crate" > 0)
);
--> statement-breakpoint
CREATE TABLE "design_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"total_quantity" integer,
	"created_by" text,
	"status" text DEFAULT 'open' NOT NULL,
	"selected_configuration_id" uuid,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_job_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "design_job_status_check" CHECK ("design_job"."status" in ('open', 'running', 'ready', 'error', 'archived')),
	CONSTRAINT "design_job_total_positive" CHECK ("design_job"."total_quantity" is null or "design_job"."total_quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_key" (
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_key_pkey" PRIMARY KEY("org_id","key")
);
--> statement-breakpoint
CREATE TABLE "org" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "part" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"material" text,
	"density_kg_m3" double precision,
	"mass_kg" double precision NOT NULL,
	"size_x_mm" double precision NOT NULL,
	"size_y_mm" double precision NOT NULL,
	"size_z_mm" double precision NOT NULL,
	"model_sha256" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "part_source_check" CHECK ("part"."source" in ('catalog', 'upload')),
	CONSTRAINT "part_mass_positive" CHECK ("part"."mass_kg" > 0)
);
--> statement-breakpoint
CREATE TABLE "part_model" (
	"org_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"object_key" text NOT NULL,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_model_pkey" PRIMARY KEY("org_id","sha256")
);
--> statement-breakpoint
CREATE TABLE "shop_standard" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"standards" jsonb NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_standard_org_version_key" UNIQUE("org_id","version")
);
--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_configuration_fk" FOREIGN KEY ("org_id","configuration_id") REFERENCES "public"."configuration"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration" ADD CONSTRAINT "configuration_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration" ADD CONSTRAINT "configuration_job_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."design_job"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_job" ADD CONSTRAINT "design_job_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_job" ADD CONSTRAINT "design_job_part_fk" FOREIGN KEY ("org_id","part_id") REFERENCES "public"."part"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_job" ADD CONSTRAINT "design_job_selected_configuration_fk" FOREIGN KEY ("org_id","selected_configuration_id") REFERENCES "public"."configuration"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_job_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."design_job"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part" ADD CONSTRAINT "part_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part" ADD CONSTRAINT "part_model_fk" FOREIGN KEY ("org_id","model_sha256") REFERENCES "public"."part_model"("org_id","sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_model" ADD CONSTRAINT "part_model_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_standard" ADD CONSTRAINT "shop_standard_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "configuration_job_idx" ON "configuration" USING btree ("org_id","job_id");--> statement-breakpoint
CREATE INDEX "design_job_org_id_idx" ON "design_job" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "event_org_job_id_idx" ON "event" USING btree ("org_id","job_id","id");--> statement-breakpoint
CREATE INDEX "part_org_id_idx" ON "part" USING btree ("org_id","created_at");
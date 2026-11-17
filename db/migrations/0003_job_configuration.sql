CREATE TABLE "job_configuration" (
	"org_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"configuration_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_configuration_pkey" PRIMARY KEY("org_id","job_id","configuration_id"),
	CONSTRAINT "job_configuration_origin_check" CHECK ("job_configuration"."origin" in ('precomputed', 'user'))
);
--> statement-breakpoint
ALTER TABLE "configuration" DROP CONSTRAINT "configuration_origin_check";--> statement-breakpoint
ALTER TABLE "configuration" DROP CONSTRAINT "configuration_job_fk";
--> statement-breakpoint
ALTER TABLE "design_job" DROP CONSTRAINT "design_job_selected_configuration_fk";
--> statement-breakpoint
DROP INDEX "configuration_job_idx";--> statement-breakpoint
ALTER TABLE "part" ADD COLUMN "catalog_id" text;--> statement-breakpoint
ALTER TABLE "job_configuration" ADD CONSTRAINT "job_configuration_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_configuration" ADD CONSTRAINT "job_configuration_job_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."design_job"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_configuration" ADD CONSTRAINT "job_configuration_configuration_fk" FOREIGN KEY ("org_id","configuration_id") REFERENCES "public"."configuration"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_configuration_job_idx" ON "job_configuration" USING btree ("org_id","job_id","created_at");--> statement-breakpoint
ALTER TABLE "design_job" ADD CONSTRAINT "design_job_selected_configuration_fk" FOREIGN KEY ("org_id","id","selected_configuration_id") REFERENCES "public"."job_configuration"("org_id","job_id","configuration_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "part_org_catalog_id_key" ON "part" USING btree ("org_id","catalog_id") WHERE "part"."catalog_id" is not null;--> statement-breakpoint
CREATE INDEX "part_org_model_idx" ON "part" USING btree ("org_id","model_sha256");--> statement-breakpoint
-- Hand-added (#46 slice 5): keep each existing configuration's job as a link before job_id goes.
INSERT INTO "job_configuration" ("org_id", "job_id", "configuration_id", "origin", "created_at")
SELECT "org_id", "job_id", "id", "origin", "created_at" FROM "configuration";--> statement-breakpoint
ALTER TABLE "configuration" DROP COLUMN "job_id";--> statement-breakpoint
ALTER TABLE "configuration" DROP COLUMN "origin";--> statement-breakpoint
ALTER TABLE "part" ADD CONSTRAINT "part_catalog_id_check" CHECK ("part"."catalog_id" is null or "part"."source" = 'catalog');
CREATE TABLE "api_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_key_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "queue_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"locked_by" text,
	"dedupe_key" text,
	"last_error" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "queue_job_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "queue_job_status_check" CHECK ("queue_job"."status" in ('queued', 'running', 'done', 'dead')),
	CONSTRAINT "queue_job_max_attempts_positive" CHECK ("queue_job"."max_attempts" > 0)
);
--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_job" ADD CONSTRAINT "queue_job_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_org_id_idx" ON "api_key" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "queue_job_claim_idx" ON "queue_job" USING btree ("run_at","created_at") WHERE "queue_job"."status" in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "queue_job_dedupe_key" ON "queue_job" USING btree ("org_id","kind","dedupe_key") WHERE "queue_job"."dedupe_key" is not null and "queue_job"."status" in ('queued', 'running');
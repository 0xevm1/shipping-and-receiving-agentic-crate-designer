ALTER TABLE "configuration" ADD COLUMN "part_hash" text;--> statement-breakpoint
ALTER TABLE "design_job" ADD COLUMN "design_part" jsonb;--> statement-breakpoint
ALTER TABLE "design_job" ADD COLUMN "design_part_hash" text;
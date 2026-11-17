ALTER TABLE "part" ADD COLUMN "model_units" text;--> statement-breakpoint
ALTER TABLE "part" ADD COLUMN "up_axis" text;--> statement-breakpoint
ALTER TABLE "part" ADD CONSTRAINT "part_model_units_check" CHECK ("part"."model_units" is null or "part"."model_units" in ('m', 'mm', 'in'));--> statement-breakpoint
ALTER TABLE "part" ADD CONSTRAINT "part_up_axis_check" CHECK ("part"."up_axis" is null or "part"."up_axis" in ('z', 'y'));
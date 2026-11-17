ALTER TABLE "artifact" DROP CONSTRAINT "artifact_configuration_kind_key";--> statement-breakpoint
CREATE INDEX "artifact_org_configuration_idx" ON "artifact" USING btree ("org_id","configuration_id");--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_org_object_key_key" UNIQUE("org_id","object_key");
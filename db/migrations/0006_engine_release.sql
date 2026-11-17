CREATE TABLE "engine_release" (
	"engine_version" text PRIMARY KEY NOT NULL,
	"first_started_at" timestamp with time zone DEFAULT now() NOT NULL
);

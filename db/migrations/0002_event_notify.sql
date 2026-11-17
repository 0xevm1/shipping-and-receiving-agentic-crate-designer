-- LISTEN/NOTIFY event framework (#46 slice 2, docs/POSTGRES.md "Events").
-- Every insert into the `event` outbox notifies channel `crate_events` in the same transaction,
-- so a rolled-back write never notifies and a committed one always does. The payload is small
-- ({id, orgId, jobId, type}, well under the 8 KB NOTIFY limit); listeners read the row by id.
-- The channel name is CRATE_EVENTS_CHANNEL in src/lib/events.ts.
CREATE OR REPLACE FUNCTION "crate_event_notify"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify(
    'crate_events',
    json_build_object('id', NEW."id", 'orgId', NEW."org_id", 'jobId', NEW."job_id", 'type', NEW."type")::text
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "event_notify" AFTER INSERT ON "event" FOR EACH ROW EXECUTE FUNCTION "crate_event_notify"();

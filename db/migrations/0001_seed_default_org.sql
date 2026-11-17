-- The single org the prototype runs as (#46, #60). Its id is DEFAULT_ORG_ID in src/server/db/org.ts.
INSERT INTO "org" ("id", "slug", "name")
VALUES ('00000000-0000-4000-8000-000000000001', 'default', 'Default org')
ON CONFLICT ("id") DO NOTHING;

import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { dropDatabase, ensureDatabase, migrateDatabase } from "./migrate";
import { DEFAULT_ORG_ID } from "./org";
import { scratchDatabaseUrl } from "./testing";

const TABLES = ["api_key", "artifact", "configuration", "design_job", "event", "idempotency_key", "org", "part", "part_model", "queue_job", "shop_standard"];

describe("db:migrate", () => {
  const url = scratchDatabaseUrl("migrate");
  afterAll(() => dropDatabase(url));

  it("creates a missing database and migrates it from empty", async () => {
    await migrateDatabase(url);
    const sql = postgres(url, { max: 1 });
    try {
      const tables = await sql<{ table_name: string }[]>`
        select table_name from information_schema.tables where table_schema = 'public' order by table_name`;
      expect(tables.map((t) => t.table_name)).toEqual(TABLES);
      const orgs = await sql`select id, slug from org`;
      expect(orgs).toEqual([{ id: DEFAULT_ORG_ID, slug: "default" }]);
    } finally {
      await sql.end();
    }
  });

  it("is idempotent: a second run applies nothing and keeps one default org", async () => {
    expect(await ensureDatabase(url)).toBe(false);
    await migrateDatabase(url);
    const sql = postgres(url, { max: 1 });
    try {
      const [{ count }] = await sql`select count(*)::int as count from org`;
      expect(count).toBe(1);
      const applied = await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
      expect(applied[0].count).toBeGreaterThanOrEqual(2);
    } finally {
      await sql.end();
    }
  });
});

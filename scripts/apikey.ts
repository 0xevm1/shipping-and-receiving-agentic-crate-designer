// API keys (#46 slice 7, docs/QUEUE.md "API keys"):
//
//   bun run apikey:create -- --name "erp-sync" [--org <uuid>]   prints the key once
//   bun run apikey:list   [-- --org <uuid>]
//   bun run apikey:revoke -- --id <uuid> [--org <uuid>]
//
// The org defaults to the prototype's single org. Reads DATABASE_URL (or DB_PORT / DB_NAME).
import { parseArgs } from "node:util";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createApiKeyStore } from "../src/server/db/apiKeys";
import { databaseUrl } from "../src/server/db/config";
import { DEFAULT_ORG_ID, orgContext } from "../src/server/db/org";
import * as schema from "../src/server/db/schema";

const [command, ...rest] = process.argv.slice(2).filter((a) => a !== "--");
const { values } = parseArgs({ args: rest, options: { name: { type: "string" }, id: { type: "string" }, org: { type: "string" } } });

function fail(message: string): never {
  console.error(`apikey: ${message}`);
  process.exit(1);
}

const org = orgContext(values.org ?? DEFAULT_ORG_ID);
const sql = postgres(databaseUrl(), { max: 1, onnotice: () => {} });
const keys = createApiKeyStore(drizzle({ client: sql, schema }));
try {
  if (command === "create") {
    const name = values.name?.trim();
    if (!name) fail('give the key a name: bun run apikey:create -- --name "erp-sync"');
    const { key, row } = await keys.create(org, name);
    console.log(`Created API key "${row.name}" (${row.id}) for org ${row.orgId}.`);
    console.log("Store it now; it is not shown again:\n");
    console.log(`  ${key}\n`);
    console.log("Send it as: Authorization: Bearer <key>");
  } else if (command === "list") {
    for (const k of await keys.list(org)) {
      const state = k.revokedAt ? `revoked ${k.revokedAt.toISOString()}` : `last used ${k.lastUsedAt?.toISOString() ?? "never"}`;
      console.log(`${k.id}  ${k.prefix}…  ${k.name}  created ${k.createdAt.toISOString()}  ${state}`);
    }
  } else if (command === "revoke") {
    if (!values.id) fail("which key? bun run apikey:revoke -- --id <uuid>");
    if (!(await keys.revoke(org, values.id))) fail(`no live key ${values.id} in org ${org.orgId}`);
    console.log(`Revoked ${values.id}.`);
  } else {
    fail(`unknown command ${JSON.stringify(command ?? "")}; use create, list or revoke`);
  }
} finally {
  await sql.end({ timeout: 5 });
}

/**
 * API keys (#46 slice 7, docs/QUEUE.md "API keys"). A key is `cdk_` plus 32 random bytes in
 * base64url; only its SHA-256 is stored. Creating, listing and revoking are org-scoped; `verify`
 * is not (it is how a request's org is found in the first place), and it reads `api_key` alone.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { type OrgContext, requireOrg } from "./org";
import type { Database } from "./repository";
import { apiKey } from "./schema";

export type ApiKey = typeof apiKey.$inferSelect;
/** A key's row without its hash, for listing. */
export type ApiKeyInfo = Omit<ApiKey, "keyHash">;

export const API_KEY_PREFIX = "cdk_";
/** `cdk_` + 43 base64url characters (32 bytes). */
const API_KEY_PATTERN = /^cdk_[A-Za-z0-9_-]{43}$/;

export const hashApiKey = (key: string): string => createHash("sha256").update(key).digest("hex");

/** A new random key. Shown once; only `hashApiKey(key)` is kept. */
export const generateApiKey = (): string => API_KEY_PREFIX + randomBytes(32).toString("base64url");

/** Don't write `last_used_at` more often than this per key (a busy script would write on every call). */
const LAST_USED_RESOLUTION_MS = 60_000;

function info(row: ApiKey): ApiKeyInfo {
  const shown: Partial<ApiKey> = { ...row };
  delete shown.keyHash;
  return shown as ApiKeyInfo;
}

export function createApiKeyStore(db: Database) {
  return {
    /** Creates a key for the org. The returned `key` is the only copy; store it now. */
    async create(ctx: OrgContext, name: string): Promise<{ key: string; row: ApiKeyInfo }> {
      const orgId = requireOrg(ctx);
      const key = generateApiKey();
      const [row] = await db
        .insert(apiKey)
        .values({ orgId, name, prefix: key.slice(0, 10), keyHash: hashApiKey(key) })
        .returning();
      return { key, row: info(row!) };
    },

    async list(ctx: OrgContext): Promise<ApiKeyInfo[]> {
      const orgId = requireOrg(ctx);
      const rows = await db.select().from(apiKey).where(eq(apiKey.orgId, orgId)).orderBy(desc(apiKey.createdAt));
      return rows.map(info);
    },

    /** Revokes a key of this org. False when there is no such live key. */
    async revoke(ctx: OrgContext, id: string): Promise<boolean> {
      const orgId = requireOrg(ctx);
      const rows = await db
        .update(apiKey)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKey.orgId, orgId), eq(apiKey.id, id), isNull(apiKey.revokedAt)))
        .returning({ id: apiKey.id });
      return rows.length > 0;
    },

    /**
     * The live key matching `key`, or undefined (unknown, malformed or revoked). Touches
     * `last_used_at` at most once a minute.
     */
    async verify(key: string): Promise<ApiKeyInfo | undefined> {
      if (!API_KEY_PATTERN.test(key)) return undefined;
      const [row] = await db
        .select()
        .from(apiKey)
        .where(and(eq(apiKey.keyHash, hashApiKey(key)), isNull(apiKey.revokedAt)));
      if (!row) return undefined;
      const now = new Date();
      if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
        await db.update(apiKey).set({ lastUsedAt: now }).where(eq(apiKey.id, row.id));
        row.lastUsedAt = now;
      }
      return info(row);
    },
  };
}

export type ApiKeyStore = ReturnType<typeof createApiKeyStore>;

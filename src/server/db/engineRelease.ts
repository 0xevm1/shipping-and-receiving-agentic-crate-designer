/**
 * Announcing a new engine (#46 §3, docs/POSTGRES.md "Engine updates"). Server-wide, so it reads
 * across orgs: the one place that does, to send each org its own `engine.updated`.
 */
import { asc } from "drizzle-orm";
import { emitEvent } from "../events/emit";
import { orgContext } from "./org";
import { createRepository, type Database } from "./repository";
import { engineRelease, org } from "./schema";

export type EngineAnnouncement = { announced: true; orgs: number } | { announced: false };

/**
 * Records `engineVersion` as started and, the first time it is seen, emits one org-wide
 * `engine.updated` per org, all in one transaction. Idempotent across processes: the version is
 * `engine_release`'s primary key, so of several instances starting at once exactly one inserts
 * (the others wait on its row and then insert nothing) and only that one emits. A version seen
 * before (a restart, or a rollback to it) announces nothing.
 */
export async function announceEngineVersion(db: Database, engineVersion: string): Promise<EngineAnnouncement> {
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(engineRelease).values({ engineVersion }).onConflictDoNothing().returning();
    if (inserted.length === 0) return { announced: false };
    const orgs = await tx.select({ id: org.id }).from(org).orderBy(asc(org.id));
    const repo = createRepository(tx);
    for (const { id } of orgs) {
      await emitEvent(repo, orgContext(id), { jobId: null, type: "engine.updated", payload: { engineVersion } });
    }
    return { announced: true, orgs: orgs.length };
  });
}

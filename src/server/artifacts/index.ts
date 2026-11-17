/**
 * Server-built artifacts (#46 slice 6, docs/API.md "Artifacts") for Route Handlers. Server-only.
 * `bun run worker` imports `createBundleHandler` from `./service` directly.
 */
import "server-only";
import { getBlobStore } from "../blob";
import { getDb } from "../db/client";
import type { OrgContext } from "../db/org";
import { ApiFailure } from "../http";
import { EngineWorkerMissingError, getEnginePool } from "../workers/engine";
import type { ArtifactsDeps } from "./service";

export { BUNDLE_SYNC_MAX_CONFIGS, configurationArtifact, createBundleHandler, jobBundle, type ArtifactsDeps, type BundleOutcome } from "./service";

/** The process's engine pool, or a 503 the client can read when its thread bundle isn't built. */
export function requireEnginePool() {
  try {
    return getEnginePool();
  } catch (e) {
    if (e instanceof EngineWorkerMissingError) console.error(e.message);
    throw new ApiFailure(503, "unavailable", "The design engine isn't running on this server. Try again shortly.");
  }
}

/** The app's database, blob store and engine pool, for `org`. */
export const artifactsDeps = (org: OrgContext): ArtifactsDeps => ({ db: getDb(), blob: getBlobStore(), org, pool: requireEnginePool });

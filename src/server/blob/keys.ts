/**
 * Object keys (#46 §2a). Every key starts with `org/<orgId>/`, and the only way to make one is a
 * builder here that takes an `OrgContext`, so nothing is stored or looked up by hash alone and one
 * org's keys never name another's objects. The store's methods take a `BlobKey`, not a string.
 *
 *   org/<orgId>/models/<sha256>.glb
 *   org/<orgId>/artifacts/<inputHash>/<engineVersion>/{crate.glb,spec.pdf,cutlist.csv}
 *   org/<orgId>/bundles/<id>.zip
 *
 * The engine version's `+` ("0.1.0+engine.3") is written as `_` in keys: S3 lists `+` among the
 * characters that need special handling (some stacks read it as a space).
 */
import { orgContext, type OrgContext, requireOrg } from "../db/org";

declare const blobKeyBrand: unique symbol;
export type BlobKey = string & { readonly [blobKeyBrand]: true };

export const ARTIFACT_FILES = ["crate.glb", "spec.pdf", "cutlist.csv"] as const;
export type ArtifactFile = (typeof ARTIFACT_FILES)[number];

const SHA256 = /^[0-9a-f]{64}$/;
/** One path segment: no slashes, no dot-only names, nothing that needs escaping. */
const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,128}$/;

function segment(what: string, value: string): string {
  if (!SEGMENT.test(value)) throw new Error(`Not a valid ${what} for an object key: ${JSON.stringify(value)}`);
  return value;
}

const orgPrefix = (ctx: OrgContext) => `org/${requireOrg(ctx)}/`;

/** A part's GLB, content-addressed by its sha256 (lowercase hex). */
export function modelKey(ctx: OrgContext, sha256: string): BlobKey {
  if (!SHA256.test(sha256)) throw new Error(`Not a sha256: ${JSON.stringify(sha256)}`);
  return `${orgPrefix(ctx)}models/${sha256}.glb` as BlobKey;
}

/** An engine version as a key segment: "0.1.0+engine.3" → "0.1.0_engine.3". */
export const versionSegment = (engineVersion: string): string => segment("engine version", engineVersion.replace(/\+/g, "_"));

/** A generated file for a configuration, by the engine's input hash and version. */
export function artifactKey(ctx: OrgContext, inputHash: string, engineVersion: string, file: ArtifactFile): BlobKey {
  if (!ARTIFACT_FILES.includes(file)) throw new Error(`Not an artifact file: ${JSON.stringify(file)}`);
  return `${orgPrefix(ctx)}artifacts/${segment("input hash", inputHash)}/${versionSegment(engineVersion)}/${file}` as BlobKey;
}

/** A "Download all" bundle. */
export function bundleKey(ctx: OrgContext, id: string): BlobKey {
  return `${orgPrefix(ctx)}bundles/${segment("bundle id", id)}.zip` as BlobKey;
}

/** Everything an org owns, for `list`. */
export function orgKeyPrefix(ctx: OrgContext): BlobKey {
  return orgPrefix(ctx) as BlobKey;
}

const OWNED = /^org\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

/**
 * The org a listed key belongs to, or undefined for a key this app didn't write. Only for
 * maintenance that walks the whole bucket (orphan cleanup); requests get their org from auth.
 */
export function orgOfKey(key: string): OrgContext | undefined {
  const match = OWNED.exec(key);
  return match ? orgContext(match[1]!.toLowerCase()) : undefined;
}

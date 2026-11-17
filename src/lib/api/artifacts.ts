/**
 * Server-built files (#46 slice 6, docs/API.md "Artifacts"): response shapes and the URLs the
 * browser links to. Pure Zod and strings, so Client Components may import it.
 *
 *   GET /api/v1/jobs/:id/configs/:cid/{crate.glb,spec.pdf,cutlist.csv}
 *   GET /api/v1/jobs/:id/bundle.zip?configs=<id>,<id>,…   (default: every configuration of the job)
 *
 * Both answer JSON with a ~5 min presigned GET URL, or, with `?redirect=1`, a 302 to it (as
 * `GET /parts/:id/model` does), so an `<a href>` downloads the file straight from blob storage.
 * A bundle too large to build during the request answers 202 (`status: "queued"`) instead and
 * `artifact.ready` follows; ask the same URL again then.
 */
import { z } from "zod";

/** The file names the artifact route serves, and the engine artifact kind behind each. */
export const ARTIFACT_FILE_KINDS = { "crate.glb": "glb", "spec.pdf": "pdf", "cutlist.csv": "csv" } as const;
export type ArtifactFileName = keyof typeof ARTIFACT_FILE_KINDS;
export const ARTIFACT_FILE_NAMES = Object.keys(ARTIFACT_FILE_KINDS) as ArtifactFileName[];

/** At most this many configurations in one server bundle (the queue payload's cap). */
export const MAX_BUNDLE_CONFIGS = 50;

const datetime = z.iso.datetime({ offset: true });

/** A stored file and a presigned URL to it. No blob credentials: the signature is the URL's own. */
export const ArtifactUrlResponseSchema = z.object({
  /** Presigned GET, ~5 min; downloads as `fileName`. */
  url: z.url(),
  expiresAt: datetime,
  artifactId: z.uuid(),
  kind: z.enum(["glb", "pdf", "csv", "zip"]),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.int().positive(),
  /** The engine that built it (the server's own), and the configuration's (or bundle's) input hash. */
  engineVersion: z.string().min(1),
  inputHash: z.string().min(1),
  builtBy: z.enum(["browser", "server"]),
  /** False when this request built it. */
  cached: z.boolean(),
});
export type ArtifactUrlResponse = z.infer<typeof ArtifactUrlResponseSchema>;

/** `GET /jobs/:id/bundle.zip`: ready (as an artifact, plus what is in it), or queued. */
export const BundleResponseSchema = z.discriminatedUnion("status", [
  ArtifactUrlResponseSchema.extend({
    status: z.literal("ready"),
    bundleId: z.string().min(1),
    configurationIds: z.array(z.uuid()).min(1),
  }),
  z.object({
    status: z.literal("queued"),
    bundleId: z.string().min(1),
    configurationIds: z.array(z.uuid()).min(1),
    /** The queue job building it; `artifact.ready` (kind `zip`) is emitted on the job when done. */
    queueJobId: z.uuid(),
  }),
]);
export type BundleResponse = z.infer<typeof BundleResponseSchema>;

const API = "/api/v1";
const seg = encodeURIComponent;

/** The link that downloads one configuration's file from the server (a 302 to blob storage). */
export function artifactHref(jobId: string, configurationId: string, file: ArtifactFileName, { redirect = true } = {}): string {
  return `${API}/jobs/${seg(jobId)}/configs/${seg(configurationId)}/${file}${redirect ? "?redirect=1" : ""}`;
}

/** The link to the job's server-built bundle; every configuration of the job when `configurationIds` is empty. */
export function bundleHref(jobId: string, configurationIds: readonly string[] = [], { redirect = true } = {}): string {
  const q = new URLSearchParams();
  if (configurationIds.length) q.set("configs", configurationIds.join(","));
  if (redirect) q.set("redirect", "1");
  const query = q.toString().replace(/%2C/g, ",");
  return `${API}/jobs/${seg(jobId)}/bundle.zip${query ? `?${query}` : ""}`;
}

/** `?configs=a,b,c` (repeated `configs=` too) as a list, in order, duplicates once. */
export function parseConfigsParam(params: URLSearchParams): string[] {
  const ids = params
    .getAll("configs")
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

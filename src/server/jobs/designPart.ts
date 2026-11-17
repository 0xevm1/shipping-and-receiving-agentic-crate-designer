/**
 * The part a job is designed from (#46 "same inputs", docs/API.md "The job's part"). The browser
 * designs from more than the server's `part` row knows: above all the measured outline (shaped
 * blocking, spec §7.5b), measured from the model in the browser. It sends its engine part with the
 * job (`POST /jobs` `designPart`, `PUT /jobs/:id/part`), and every server-side engine call for the
 * job builds its request from `jobDesignPart` through the engine's one request builder
 * (`sweepRequestFor`, src/engine/request.ts), so the browser's and the server's sweeps, total plans
 * and configurations are made from the same inputs.
 *
 * Content-addressed: `designPartHash` names the version of the part; a sweep's configurations
 * carry it (`configuration.part_hash`), and only the current version's are served.
 */
import { catalog } from "@/domain/catalog";
import type { DesignPart } from "@/domain/schema";
import { designPartOf } from "@/engine/engine";
import { designPartHash } from "@/engine/request";
import { DesignPartSchema } from "@/engine/schemas";
import type { OrgContext } from "../db/org";
import type { DesignJob, JobConfiguration, Part, Repository } from "../db/repository";
import { runPartChangedHooks } from "./hooks";

/**
 * The engine's part from the part row's facts: what a job designs from until a browser sends its
 * own. A catalog part brings the catalog's suggested quantities (#133); any other part none, so
 * its sweep chooses among the defaults (1, 4 and 8).
 */
export function rowDesignPart(p: Part): DesignPart {
  const suggested = p.catalogId ? catalog.parts.find((c) => c.id === p.catalogId)?.suggested_quantities : undefined;
  return {
    id: p.id,
    name: p.name,
    mass_kg: p.massKg,
    dimensions_mm: [p.sizeXMm, p.sizeYMm, p.sizeZMm],
    ...(p.material ? { material: p.material } : {}),
    ...(suggested ? { suggested_quantities: suggested } : {}),
  };
}

/** The stored design part, parsed; null when there is none or it no longer parses. */
function storedDesignPart(job: Pick<DesignJob, "designPart">): DesignPart | null {
  if (!job.designPart) return null;
  const parsed = DesignPartSchema.safeParse(job.designPart);
  return parsed.success ? parsed.data : null;
}

/** What the job is designed from: the part the browser sent, else the part row's facts. */
export function jobDesignPart(job: Pick<DesignJob, "designPart">, part: Part): DesignPart {
  return storedDesignPart(job) ?? rowDesignPart(part);
}

/** The version of the part the job's server-side results must be for. */
export function jobPartHash(job: Pick<DesignJob, "designPart" | "designPartHash">, part: Part): string {
  return job.designPartHash ?? designPartHash(rowDesignPart(part));
}

/**
 * Whether a job's configuration is served: one a person saved always is (it is their record, and
 * carries its own part); a sweep's (`precomputed`) only while it was made from the job's current part.
 */
export function isCurrentConfiguration(c: Pick<JobConfiguration, "origin" | "partHash">, partHash: string): boolean {
  return c.origin === "user" || c.partHash === null || c.partHash === partHash;
}

/**
 * The part to store for `incoming`, or null when the job's results already fit it. A part sent
 * without a measured outline never replaces the same part with one: the outline is a fact of the
 * model, and a browser that hasn't measured it yet (or couldn't) sends none.
 */
export function partToStore(
  job: Pick<DesignJob, "designPart" | "designPartHash">,
  part: Part,
  incoming: DesignPart,
): { designPart: DesignPart; hash: string } | null {
  let next = designPartOf(incoming);
  const stored = storedDesignPart(job);
  if (!next.profile && stored?.profile) {
    const withOutline = { ...next, profile: stored.profile };
    if (designPartHash(withOutline) === job.designPartHash) return null;
    // Another change (a mass, say) keeps the outline the model was measured with, when the size is the same.
    if (stored.dimensions_mm.every((v, i) => v === next.dimensions_mm[i])) next = withOutline;
  }
  // The same for a centre of gravity estimated from the mesh (#110): a fact of the model that a browser which
  // hasn't estimated it yet sends none of. A supplied one is the person's and is sent (or cleared) explicitly.
  if (!next.cog && stored?.cog?.source === "estimated" && stored.dimensions_mm.every((v, i) => v === next.dimensions_mm[i])) {
    next = { ...next, cog: stored.cog };
  }
  const hash = designPartHash(next);
  return hash === jobPartHash(job, part) ? null : { designPart: JSON.parse(JSON.stringify(next)) as DesignPart, hash };
}

/**
 * Stores `incoming` as the job's part when it differs from what the job's results were made from,
 * and queues the sweep that remakes them (the `onPartChanged` hooks). Run inside the transaction
 * that reads the job. Returns the job as it now is and whether it changed.
 */
export async function applyDesignPart(
  tx: Repository,
  org: OrgContext,
  job: DesignJob,
  part: Part,
  incoming: DesignPart,
): Promise<{ job: DesignJob; changed: boolean }> {
  const next = partToStore(job, part, incoming);
  if (!next) return { job, changed: false };
  const selected = job.selectedConfigurationId ? await tx.configurations.getForJob(org, job.id, job.selectedConfigurationId) : undefined;
  const updated = await tx.jobs.setDesignPart(org, job.id, {
    designPart: next.designPart,
    designPartHash: next.hash,
    // A finished job is re-swept for the new part; an archived one stays archived.
    status: job.status === "ready" || job.status === "error" ? "running" : undefined,
    clearSelection: selected?.origin === "precomputed",
  });
  if (!updated) throw new Error("A job read in this transaction failed to update.");
  if (updated.status !== "archived") await runPartChangedHooks(tx, org, updated);
  return { job: updated, changed: true };
}

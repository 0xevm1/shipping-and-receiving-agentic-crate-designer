/** Rows to the JSON shapes of src/lib/api/jobs.ts. */
import type { ConfigurationResponse, JobResponse, JobSnapshot } from "@/lib/api/jobs";
import type { Artifact, DesignJob, JobConfiguration } from "../db/repository";

export function jobResponse(job: DesignJob): JobResponse {
  return {
    id: job.id,
    partId: job.partId,
    status: job.status,
    totalQuantity: job.totalQuantity,
    selectedConfigurationId: job.selectedConfigurationId,
    notes: job.notes,
    version: job.version,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

type StoredRequest = { settings?: Record<string, unknown>; layoutKey?: string | null; ranking?: string };

export function configurationResponse(c: JobConfiguration): ConfigurationResponse {
  // `settings` holds the whole DesignRequest; it was validated when it was saved.
  const request = (c.settings ?? {}) as StoredRequest;
  return {
    id: c.id,
    inputHash: c.inputHash,
    engineVersion: c.engineVersion,
    quantityPerCrate: c.quantityPerCrate,
    layout: c.layout,
    score: c.score,
    origin: c.origin,
    summary: (c.resultSummary as Record<string, unknown> | null) ?? null,
    design: { settings: request.settings ?? {}, layoutKey: request.layoutKey ?? null, ranking: request.ranking ?? "volume" },
    createdAt: c.createdAt.toISOString(),
    addedAt: c.addedAt.toISOString(),
  };
}

export function artifactResponse(a: Artifact): JobSnapshot["artifacts"][number] {
  return {
    id: a.id,
    configurationId: a.configurationId,
    kind: a.kind,
    sha256: a.sha256,
    sizeBytes: a.sizeBytes,
    builtBy: a.builtBy,
    createdAt: a.createdAt.toISOString(),
  };
}

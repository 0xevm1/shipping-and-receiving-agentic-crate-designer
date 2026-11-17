/**
 * The engine calls the server runs in worker threads (#46 slice 7): never on the thread that
 * serves requests or holds SSE streams (spec §5.1, docs/QUEUE.md "Worker threads"). Plain data
 * in and out, so they cross `postMessage` as structured clones.
 */
import type { DesignRequest, DesignResponse } from "@/engine/schemas";
import type { SweepRequest, SweepResponse } from "@/engine/sweep";
import type { BundleInput } from "@/lib/exportBundle";
import type { DesignsResponse } from "@/lib/api/designs";

export interface EngineTasks {
  /** `runSweep`: the curve, shortlist, recommendation and total plan. */
  sweep: { input: SweepRequest; output: SweepResponse };
  /** `rankConfigurations`: the sweep plus every shortlisted quantity designed in full. */
  designs: { input: SweepRequest; output: DesignsResponse };
  /** `designShipment`: one design. */
  design: { input: DesignRequest; output: DesignResponse };
  /** `buildBundleZip` from the part's GLB bytes: the ZIP with GLB, PDF, CSV and design.json. */
  bundle: {
    input: { bundle: BundleInput & { layoutKey: string | null }; glb: ArrayBuffer };
    output: { name: string; zip: Uint8Array; engineVersion: string; inputHash: string };
  };
}
export type EngineTaskKind = keyof EngineTasks;

export type EngineTaskMessage = { [K in EngineTaskKind]: { id: number; kind: K; input: EngineTasks[K]["input"] } }[EngineTaskKind];
export type EngineTaskResult = { id: number; ok: true; output: unknown } | { id: number; ok: false; error: string };

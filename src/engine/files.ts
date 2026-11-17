import type { BundleInput } from "@/lib/exportBundle";
import type { PartModelReader } from "./glb";
import type { EngineStamp } from "./schemas";
import { stamp } from "./engine";
import { sweepFor } from "./artifacts";

/**
 * The download package (spec §7.13) built by the engine, in any runtime. The PDF (jsPDF), ZIP
 * (fflate) and GLB (three.js exporter) code is loaded with `import()` on the first call, so none
 * of it is in the page's first load. The browser passes `urlModelReader`; Node passes
 * `bytesModelReader(glbBytes)`.
 */
export interface BundleZip extends EngineStamp {
  /** "crate-PART-001-x4.zip". */
  name: string;
  zip: Uint8Array;
}

/** `input.layoutKey` is the layout pick the plan was made with (null for the recommended one), for the stamp. */
export async function buildBundleZip(
  input: BundleInput & { layoutKey: string | null },
  read: PartModelReader,
  at = new Date(input.generatedAt),
): Promise<BundleZip> {
  const [{ buildBundle, zipBundle }, { glbMaker }] = await Promise.all([import("@/lib/exportBundle"), import("./glb")]);
  const { part, settings, standards, ranking, layoutKey } = input;
  const st = stamp({ part, settings, standards, ranking, layoutKey });
  const bundle = await buildBundle(
    { ...input, stamp: st, sweep: input.sweep === undefined ? sweepFor({ part, settings, standards, ranking, layoutKey }) : input.sweep },
    {
      glb: glbMaker(input.part, read, { ...st }),
      pdf: async (doc) => (await import("@/lib/exportPdf")).printableToPdf(doc),
    },
  );
  return { ...st, name: bundle.name, zip: zipBundle(bundle.files, at) };
}

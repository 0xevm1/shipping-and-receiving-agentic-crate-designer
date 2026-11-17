import type { BundleInput } from "@/lib/exportBundle";
import type { PartModelReader } from "./glb";
import type { EngineStamp } from "./schemas";
import { stamp } from "./engine";

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
  const bundle = await buildBundle(input, {
    glb: glbMaker(input.part, read),
    pdf: async (doc) => (await import("@/lib/exportPdf")).printableToPdf(doc),
  });
  const { part, settings, standards, ranking, layoutKey } = input;
  return { ...stamp({ part, settings, standards, ranking, layoutKey }), name: bundle.name, zip: zipBundle(bundle.files, at) };
}

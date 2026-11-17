import type { ShipmentPlan } from "@/domain/shipment";
import { costsArePlaceholder } from "@/domain/standards";
import { sweepQuantities, type QuantitySweep } from "@/domain/sweep";
import { stampCsv } from "@/lib/csv";
import type { Units } from "@/lib/units";
import { cutList, designShipment, inputHash, stamp } from "./engine";
import type { PartModelReader } from "./glb";
import type { DesignRequest, EngineStamp } from "./schemas";
import { sha256Hex, sha256Text } from "./sha256";
import { ENGINE_VERSION } from "./version";

/**
 * Artifacts (spec §7.17): the files the engine builds for one configuration (a `DesignRequest`),
 * each on its own, and the multi-configuration bundle. The browser's **Download all** and the
 * server's artifact and `bundle.zip` routes call exactly these, so the bytes agree.
 *
 * Every file carries the engine's stamp (spec §5.1): the GLB in its scene `extras`, the PDF in its
 * keywords and footer, the CSV in a `#` line. The PDF (jsPDF), ZIP (fflate) and GLB (three.js)
 * code is loaded with `import()` on first use, so importing this module costs the page nothing
 * but the sweep.
 */

export const ARTIFACT_KINDS = ["glb", "pdf", "csv"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const ARTIFACT_CONTENT_TYPES: Record<ArtifactKind, string> = {
  glb: "model/gltf-binary",
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
};

/** A configuration plus how its files are written. Only the `DesignRequest` part is hashed. */
export interface ArtifactRequest extends DesignRequest {
  /** Units of the PDF and CSV; imperial when absent, as the app starts. */
  units?: Units;
  /** The crate type of a split batch the GLB shows; the first when absent. */
  crateIndex?: number;
  /** ISO time stamped into the PDF (its date and creation date); now when absent. */
  generatedAt?: string;
  /** IANA zone the PDF's date is read in; the runtime's own zone when absent. */
  timeZone?: string;
  /** The part's sweep under these rules, when the caller has it; run here when absent. */
  sweep?: QuantitySweep | null;
  /** The plan for this request, when the caller has it (it must be `designShipment(request).plan`). */
  plan?: ShipmentPlan;
}

export interface Artifact extends EngineStamp {
  kind: ArtifactKind;
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
  /** SHA-256 (hex) of `bytes`. */
  sha256: string;
}

/** Requests that differ only in quantity, layout pick or ranking share one sweep. */
const sweepKey = (req: DesignRequest) => inputHash({ ...req, settings: { ...req.settings, quantity: 1 }, layoutKey: null, ranking: "volume" });

/** The quantity sweep (spec §7.16) for a request's part and rules. No freight rates, so no freight dollars. */
export function sweepFor(req: DesignRequest): QuantitySweep {
  return sweepQuantities(req.part, req.settings, req.standards);
}

const done = (kind: ArtifactKind, bytes: Uint8Array, fileName: string, st: EngineStamp): Artifact => ({
  ...st,
  kind,
  bytes,
  contentType: ARTIFACT_CONTENT_TYPES[kind],
  fileName,
  sha256: sha256Hex(bytes),
});

/**
 * One artifact for one configuration, in any runtime:
 * - `glb`: the crate type at `crateIndex` with the parts in place (`read` gives the part's model;
 *   null gives the boards only), stamped in the scene's `extras`.
 * - `pdf`: crate spec, build sheets and labels (§7.11), with the quantity rationale (§7.16) and
 *   the stamp.
 * - `csv`: the cut list (the whole shipment for a split batch), with a stamp line.
 *
 * Throws `NoCrateError` for a GLB or CSV when there is no crate (§7.9); the PDF then says why.
 */
export async function buildArtifact(kind: ArtifactKind, req: ArtifactRequest, read: PartModelReader | null): Promise<Artifact> {
  const { part, settings, standards, layoutKey, ranking } = req;
  const design: DesignRequest = { part, settings, standards, layoutKey, ranking };
  const st = stamp(design);
  const plan = req.plan ?? designShipment(design).plan;
  const units = req.units ?? "imperial";
  const { bundleStem, NoCrateError } = await import("@/lib/exportBundle");
  const stem = bundleStem(part.id, settings.quantity);
  const noCrate = () => new NoCrateError(plan.problem ? `${plan.problem.title}. ${plan.problem.detail}` : "There is no crate to export.");

  if (kind === "csv") {
    if (plan.problem || !plan.crates[0]?.result.design) throw noCrate();
    const out = cutList({ ...design, units, scope: plan.split ? "shipment" : "crate", crateIndex: req.crateIndex ?? 0 }, plan);
    // The Cut list tab's name, with the part id made file-name safe like the other files (a ZIP path never gains a folder).
    const fileName = `${stem}${out.fileName.slice(`crate-${part.id}-x${settings.quantity}`.length)}`;
    return done(kind, new TextEncoder().encode(stampCsv(out.csv, st)), fileName, st);
  }
  if (kind === "glb") {
    const type = plan.crates[req.crateIndex ?? 0] ?? plan.crates[0];
    if (plan.problem || !type?.result.design) throw noCrate();
    const { glbMaker } = await import("./glb");
    const bytes = new Uint8Array(await glbMaker(part, read, { ...st })(type.result.design));
    return done(kind, bytes, plan.split ? `${stem}-crate-${type.label}.glb` : `${stem}.glb`, st);
  }
  const [{ buildPrintable }, { printableToPdf }] = await Promise.all([import("@/lib/printable"), import("@/lib/exportPdf")]);
  const doc = buildPrintable({
    part,
    plan,
    standards,
    units,
    ranking,
    generatedAt: req.generatedAt ?? new Date().toISOString(),
    timeZone: req.timeZone,
    sweep: req.sweep === undefined ? sweepFor(design) : req.sweep,
    stamp: st,
  });
  return done(kind, printableToPdf(doc), `${stem}.pdf`, st);
}

/** One file in the bundle, as the manifest lists it. */
export interface ManifestFile {
  path: string;
  kind: ArtifactKind | "comparison";
  contentType: string;
  bytes: number;
  sha256: string;
}

export interface ManifestConfiguration {
  folder: string;
  engineVersion: string;
  inputHash: string;
  quantity: number;
  /** The layout pick (null: the recommended layout for the ranking). */
  layoutKey: string | null;
  /** The layout the crate (crate A) was made with. */
  layout: string | null;
  ranking: DesignRequest["ranking"];
  /** The sweep's recommendation: its quantity and layout. */
  recommended: boolean;
  split: boolean;
  crates: number;
  perCrate: number[];
  /** Crate A's outside size, mm. */
  outsideMm: [number, number, number] | null;
  /** Crate A's gross, kg. */
  grossKg: number | null;
  /** Crate cost (wood, screws, labour) ÷ parts; never freight. */
  crateCostUsdPerPart: number | null;
  problem: string | null;
  files: ManifestFile[];
}

/** `manifest.json` of a multi-configuration bundle (spec §7.17). */
export interface BundleManifest {
  kind: "crate-designer/bundle";
  version: 1;
  engineVersion: string;
  /** SHA-256 of the configurations' input hashes, in order, joined by newlines. */
  bundleHash: string;
  created: string;
  units: Units;
  part: { id: string; name: string };
  /** Always `crate-only` here: no freight rates, so no freight dollars anywhere. */
  costBasis: "crate-only";
  /** True while any cost input is the shipped placeholder (§7.12). */
  placeholderCosts: boolean;
  recommendation: {
    quantity: number;
    layoutKey: string;
    crateCostUsdPerPart: number;
    rationale: string;
    stoppedBy: { quantity: number; constraint: string; reason: string } | null;
  } | null;
  configurations: ManifestConfiguration[];
  /** Files outside the folders (the comparison PDF); `manifest.json` itself is not listed. */
  files: ManifestFile[];
}

export interface MultiBundle {
  /** "crates-PART-001-3-configs.zip". */
  name: string;
  zip: Uint8Array;
  manifest: BundleManifest;
  engineVersion: string;
  /** The bundle's hash (`manifest.bundleHash`). */
  inputHash: string;
}

export interface MultiBundleOptions {
  units?: Units;
  /** ISO time: the manifest's `created`, the PDFs' dates and the ZIP entries' times. Now when absent. */
  generatedAt?: string;
  timeZone?: string;
}

const pad = (n: number, of: number) => String(n).padStart(Math.max(2, String(of).length), "0");

/**
 * One ZIP for several configurations (spec §7.17): a folder per configuration with its GLB (one
 * per crate type of a split batch), PDF and CSV; `comparison.pdf`; and `manifest.json` with the
 * engine version, each configuration's input hash, and every file's size and SHA-256.
 *
 * `configs` is a plain array of design requests: the browser's current design and the sweep's
 * shortlist today, a job's saved configurations later. Duplicates (equal input hashes) are
 * kept once. Configurations with no crate get a folder with the PDF only (it says why).
 */
export async function buildMultiBundleZip(configs: DesignRequest[], read: PartModelReader | null, options: MultiBundleOptions = {}): Promise<MultiBundle> {
  if (!configs.length) throw new Error("There are no configurations to bundle.");
  const units = options.units ?? "imperial";
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const at = new Date(generatedAt);

  const byHash = new Map<string, { req: DesignRequest; st: EngineStamp }>();
  for (const req of configs) {
    const st = stamp(req);
    if (!byHash.has(st.inputHash)) byHash.set(st.inputHash, { req, st });
  }
  const unique = [...byHash.values()];

  const sweeps = new Map<string, QuantitySweep>();
  const sweepOf = (req: DesignRequest) => {
    const k = sweepKey(req);
    let s = sweeps.get(k);
    if (!s) sweeps.set(k, (s = sweepFor(req)));
    return s;
  };

  const [{ zipSync }, { isRecommended, CONSTRAINT_TEXT }, { buildComparison }, { comparisonToPdf }, { renderMessage }] = await Promise.all([
    import("fflate"),
    import("@/lib/printable"),
    import("@/lib/comparison"),
    import("@/lib/comparisonPdf"),
    import("@/lib/message"),
  ]);

  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
  const add = (path: string, a: { bytes: Uint8Array; contentType: string; sha256: string }, kind: ManifestFile["kind"]): ManifestFile => {
    entries[path] = [a.bytes, { mtime: at }];
    return { path, kind, contentType: a.contentType, bytes: a.bytes.length, sha256: a.sha256 };
  };

  const rows: ManifestConfiguration[] = [];
  const comparisonConfigs = [];
  for (const [i, { req, st }] of unique.entries()) {
    const plan = designShipment(req).plan;
    const sweep = sweepOf(req);
    const recommended = isRecommended(plan, sweep);
    const folder = `${pad(i + 1, unique.length)}-x${req.settings.quantity}${recommended ? "-recommended" : ""}`;
    const base: ArtifactRequest = { ...req, units, generatedAt, timeZone: options.timeZone, sweep, plan };
    const files: ManifestFile[] = [];
    const hasCrate = !plan.problem && plan.crates.every((t) => t.result.design);
    if (hasCrate) {
      for (const [ci] of plan.crates.entries()) {
        const glb = await buildArtifact("glb", { ...base, crateIndex: ci }, read);
        files.push(add(`${folder}/${glb.fileName}`, glb, "glb"));
      }
    }
    const pdf = await buildArtifact("pdf", base, read);
    files.push(add(`${folder}/${pdf.fileName}`, pdf, "pdf"));
    if (hasCrate) {
      const csv = await buildArtifact("csv", base, read);
      files.push(add(`${folder}/${csv.fileName}`, csv, "csv"));
    }
    const first = plan.crates[0]?.result.design ?? null;
    rows.push({
      folder,
      ...st,
      quantity: req.settings.quantity,
      layoutKey: req.layoutKey,
      layout: first?.layout.key ?? null,
      ranking: req.ranking,
      recommended,
      split: plan.split,
      crates: plan.totals.crates,
      perCrate: plan.crates.map((t) => t.quantity),
      outsideMm: first ? [...first.layout.external] : null,
      grossKg: first?.grossKg ?? null,
      crateCostUsdPerPart: hasCrate ? plan.totals.costUsd / Math.max(1, plan.totals.parts) : null,
      problem: plan.problem ? `${plan.problem.title}. ${plan.problem.detail}` : null,
      files,
    });
    comparisonConfigs.push({ label: folder, part: req.part, plan, standards: req.standards, sweep });
  }

  const bundleHash = sha256Text(rows.map((r) => r.inputHash).join("\n"));
  const comparison = comparisonToPdf(
    buildComparison({
      configs: comparisonConfigs,
      units,
      generatedAt,
      timeZone: options.timeZone,
      stamp: { engineVersion: ENGINE_VERSION, inputHash: bundleHash },
    }),
  );
  const top = add("comparison.pdf", { bytes: comparison, contentType: ARTIFACT_CONTENT_TYPES.pdf, sha256: sha256Hex(comparison) }, "comparison");

  const first = unique[0].req;
  const rec = sweepOf(first).recommendation;
  const manifest: BundleManifest = {
    kind: "crate-designer/bundle",
    version: 1,
    engineVersion: ENGINE_VERSION,
    bundleHash,
    created: generatedAt,
    units,
    part: { id: first.part.id, name: first.part.name },
    costBasis: "crate-only",
    placeholderCosts: unique.some(({ req }) => costsArePlaceholder(req.standards)),
    recommendation: rec
      ? {
          quantity: rec.quantity,
          layoutKey: rec.crate.layoutKey,
          crateCostUsdPerPart: rec.crate.scoreUsdPerPart,
          rationale: renderMessage(rec.rationale, units),
          stoppedBy: rec.stoppedBy
            ? { quantity: rec.stoppedBy.quantity, constraint: CONSTRAINT_TEXT[rec.stoppedBy.binding], reason: renderMessage(rec.stoppedBy.reason, units) }
            : null,
        }
      : null,
    configurations: rows,
    files: [top],
  };
  entries["manifest.json"] = [new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`), { mtime: at }];

  const { fileSafe } = await import("@/lib/exportBundle");
  const name = `crates-${fileSafe(first.part.id)}-${rows.length}-config${rows.length === 1 ? "" : "s"}.zip`;
  return { name, zip: zipSync(entries, { level: 6 }), manifest, engineVersion: ENGINE_VERSION, inputHash: bundleHash };
}

/**
 * The Export pill's package: everything a crate needs to leave the building, as one .zip
 * built in the browser (nothing is uploaded).
 *
 *     crate-PART-001-x4.zip
 *     ├─ crate-PART-001-x4.glb      the assembled crate with the parts; a split batch has
 *     │                             one per crate type: …-crate-A.glb, …-crate-B.glb
 *     ├─ crate-PART-001-x4.pdf      crate spec, build sheets and labels, every crate type
 *     ├─ cut-list.csv               the cut list in the selected units; a split batch has
 *     │                             cut-list-crate-A.csv … plus shipment-cut-list.csv
 *     ├─ design.json                the design file, re-importable with Load a part
 *     └─ README.txt                 what each file is for, the app version, date and units
 *
 * `buildBundle` is pure apart from its two injected makers (GLB and PDF), so the file list,
 * names and texts are unit-tested in Node. `browserBundle` wires in the real ones; the PDF
 * code (jsPDF) is loaded with `import()` only then.
 */
import { zipSync, type Zippable } from "fflate";
import type { CrateDesign } from "@/domain/crate";
import type { Ranking } from "@/domain/design";
import { serializeDesign } from "@/domain/designFile";
import type { CrateSettings } from "@/domain/schema";
import { describeShipment, type ShipmentPlan } from "@/domain/shipment";
import type { ShopStandards } from "@/domain/standards";
import { type LoadedPart } from "./part";
import { APP } from "./appInfo";
import { bomToCsv, shipmentToCsv } from "./csv";
import { documentDate } from "./format";
import { renderMessage } from "./message";
import { designFilePart } from "./loadPart";
import { models } from "./modelRegistry";
import { framedScene } from "./partFrame";
import { buildPrintable, type PrintableDesign } from "./printable";
import type { Units } from "./units";

export interface BundleInput {
  part: LoadedPart;
  settings: CrateSettings;
  plan: ShipmentPlan;
  /** The crate type on screen; the design file records its layout. */
  crateIndex: number;
  standards: ShopStandards;
  units: Units;
  /** How the plan was ranked: the PDF's "why this layout won" and design.json record it. */
  ranking: Ranking;
  /** ISO timestamp; passed in so this stays pure. */
  generatedAt: string;
  /** IANA zone the dates in the PDF and README are read in; this device's own zone when absent. */
  timeZone?: string;
}

export interface BundleMakers {
  /** The crate as binary glTF, with the parts in place. */
  glb: (design: CrateDesign) => Promise<ArrayBuffer>;
  /** The export document as PDF bytes. */
  pdf: (doc: PrintableDesign) => Promise<Uint8Array>;
}

export interface BundleFile {
  name: string;
  data: Uint8Array;
}

export interface Bundle {
  /** "crate-PART-001-x4.zip". */
  name: string;
  files: BundleFile[];
}

/** File-name safe: a custom part's id comes from its file name and may hold spaces or slashes. */
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "part";

/** "crate-PART-001-x4", the stem every file in the package shares. */
export function bundleStem(partId: string, quantity: number): string {
  return `crate-${safe(partId)}-x${quantity}`;
}

export function zipFileName(partId: string, quantity: number): string {
  return `${bundleStem(partId, quantity)}.zip`;
}

export class NoCrateError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "NoCrateError";
  }
}

const UNITS_TEXT: Record<Units, string> = {
  imperial: "inches and pounds (cuts to the nearest 1/16 in, lumber by nominal size)",
  metric: "millimetres and kilograms",
};

const encode = (s: string) => new TextEncoder().encode(s);

/** The package's files, in the order they are zipped. */
export async function buildBundle(input: BundleInput, make: BundleMakers): Promise<Bundle> {
  const { part, settings, plan, crateIndex, standards, units, ranking, generatedAt, timeZone } = input;
  const shown = plan.crates[crateIndex]?.result.design ?? plan.crates[0]?.result.design;
  if (!shown || plan.problem)
    throw new NoCrateError(plan.problem ? `${plan.problem.title}. ${renderMessage(plan.problem.detail, units)}` : "There is no crate to export.");
  const designs = plan.crates.map((t) => {
    if (!t.result.design) throw new NoCrateError(`Crate ${t.label} has no design.`);
    return { label: t.label, design: t.result.design };
  });

  const stem = bundleStem(part.id, settings.quantity);
  const split = plan.split;
  const files: BundleFile[] = [];
  const notes: [string, string][] = [];

  for (const { label, design } of designs) {
    const name = split ? `${stem}-crate-${label}.glb` : `${stem}.glb`;
    files.push({ name, data: new Uint8Array(await make.glb(design)) });
    notes.push([
      name,
      `The assembled crate${split ? ` type ${label}` : ""} as a 3D model with the parts in place (binary glTF, metres, Z up). Opens in Blender, CAD tools and most 3D viewers.`,
    ]);
  }

  const doc = buildPrintable({ part, plan, standards, units, ranking, generatedAt, timeZone });
  files.push({ name: `${stem}.pdf`, data: await make.pdf(doc) });
  notes.push([
    `${stem}.pdf`,
    `Crate spec with freight terms and why this layout won (logistics), build sheet with drawings, cut list, fasteners and assembly order (shop), and the shipping label (dock)${split ? ", for every crate type" : ""}.`,
  ]);

  if (split) {
    for (const { label, design } of designs) {
      const name = `cut-list-crate-${label}.csv`;
      files.push({ name, data: encode(bomToCsv(part, design, units)) });
      notes.push([name, `The cut list for one crate ${label}, for the shop floor or a spreadsheet.`]);
    }
    files.push({ name: "shipment-cut-list.csv", data: encode(shipmentToCsv(part, plan, units)) });
    notes.push(["shipment-cut-list.csv", `Every piece for all ${plan.totals.crates} crates, equal pieces merged.`]);
  } else {
    files.push({ name: "cut-list.csv", data: encode(bomToCsv(part, shown, units)) });
    notes.push(["cut-list.csv", "The cut list, for the shop floor or a spreadsheet."]);
  }

  const designText = serializeDesign({
    part: designFilePart(part),
    settings,
    layoutKey: shown.layout.key,
    ranking,
    design: shown,
    plan,
    app: APP,
    savedAt: generatedAt,
  });
  files.push({ name: "design.json", data: encode(designText) });
  notes.push([
    "design.json",
    `The design file: open it again with Load a part in Crate Designer to get this design back${part.model && designFilePart(part).source === "custom" ? ` (load ${part.model} with it)` : ""}.`,
  ]);
  notes.push(["README.txt", "This file."]);

  files.push({ name: "README.txt", data: encode(readme(input, stem, notes)) });
  return { name: `${stem}.zip`, files };
}

/** README.txt: what each file is for, the app version, the date and the units. */
function readme(input: BundleInput, stem: string, files: [string, string][]): string {
  const { part, plan, units, generatedAt, timeZone } = input;
  const width = Math.max(...files.map(([n]) => n.length)) + 2;
  const lines = [
    `Crate Designer export: ${stem}`,
    "",
    `Part:      ${part.id} ${part.name}`,
    `Quantity:  ${plan.totals.parts}${plan.split ? `, shipping as ${describeShipment(plan).replace(/×/g, "x")}` : ""}`,
    `Made:      ${documentDate(generatedAt, timeZone)} (${generatedAt})`,
    `App:       ${APP.name} ${APP.version}`,
    `Units:     ${UNITS_TEXT[units]} in the PDF and CSV; the 3D model is in metres; design.json stores mm and kg.`,
    "",
    "Files",
    ...files.map(([name, what]) => `  ${name.padEnd(width)}${what}`),
    "",
    "Every file was made in your browser; nothing was uploaded.",
    "",
  ];
  return lines.join("\n");
}

/** The files as a .zip, each stamped with the export time. */
export function zipBundle(files: BundleFile[], at: Date): Uint8Array {
  const entries: Zippable = {};
  for (const f of files) entries[f.name] = [f.data, { mtime: at }];
  return zipSync(entries, { level: 6 });
}

/**
 * The real makers, for the browser: GLBs through `exportCrateGlb` with the part model (parsed
 * once by the model registry, usually already by the viewer), and the PDF through a lazily loaded jsPDF.
 */
export async function browserMakers(part: LoadedPart): Promise<BundleMakers> {
  const { exportCrateGlb } = await import("./exportGlb");
  return {
    glb: async (design) => {
      // The registry's parsed model, shared with the viewer; the caller holds it for the whole run.
      const scene = framedScene(await models.scene(part.modelUrl), part.upAxis);
      return exportCrateGlb(design, { scene, mmPerUnit: part.mmPerUnit, material: part.material });
    },
    pdf: async (doc) => (await import("./exportPdf")).printableToPdf(doc),
  };
}

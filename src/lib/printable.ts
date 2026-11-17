/**
 * The export document: the PM's hand-off as one pure model, `PrintableDesign`, built from a
 * shipment plan. The print route (`src/app/print`) renders it as HTML and the PDF export
 * (`exportPdf.ts`) lays out the same model, so the two cannot disagree.
 *
 * Three audiences, in print order:
 * - **Crate spec** (PM and logistics): part, quantity, outside size, weights, volume, freight
 *   terms, the layout and why it won, every check; for a split batch, the plan and one spec
 *   per crate type.
 * - **Build sheet** per crate type (shop): drawings, the cut list by stock, fasteners, and the
 *   assembly order base → walls → load parts → blocking and separators → lid.
 * - **Shipping label** per crate type (dock).
 *
 * Text follows the selected units: imperial by default, with fractional inches, nominal
 * lumber names and lb; metric when chosen. Formatted with the same helpers as the UI and CSV.
 */
import { ASSEMBLY_NAMES } from "@/domain/crate";
import { longAxis } from "@/domain/cradles";
import type { BomLine, Check, CrateDesign, Member, ScrewLine } from "@/domain/crate";
import { screwSchedule } from "@/domain/crate";
import { explainLayout, type LayoutExplanation, type Ranking } from "@/domain/design";
import { fileProfile, parseDesignFile, restoreDesign } from "@/domain/designFile";
import type { Message } from "@/domain/message";
import type { Layout } from "@/domain/packing";
import type { DesignPart } from "@/domain/schema";
import { describeShipment, planShipment, type CrateType, type ShipmentPlan } from "@/domain/shipment";
import { costsArePlaceholder, type ShopStandards } from "@/domain/standards";
import type { QuantitySweep, SweepConstraint } from "@/domain/sweep";
import { renderMessage } from "./message";
import { allChecks } from "@/lib/checks";
import { crateDrawings, type Drawing } from "./drawings";
import { cutText, describeLayout, documentDate, stockText, usdCents } from "./format";
import { memberBounds } from "./memberBounds";
import { LB_PER_KG } from "@/domain/units";
import { area, cut, dims, dimsOther, groupDigits, lengthUnit, run, volume, weight, type Units } from "./units";

/** A labelled value, with an optional second line (the other units, or how it was worked out). */
export interface Row {
  label: string;
  value: string;
  note?: string;
}

interface PrintableCheck {
  id: string;
  level: Check["level"];
  levelText: "Pass" | "Caution" | "Info";
  title: string;
  detail: string;
}

interface CutGroup {
  /** "4x4", "1/2″ plywood", "19 × 89 lumber". */
  stock: string;
  material: BomLine["material"];
  lines: { piece: string; assembly: string; cut: string; qty: number }[];
  pieces: number;
  /** Running length (lumber) or area (plywood) of this stock. */
  total: string;
}

interface Fastener {
  title: string;
  rule: string;
  qty: number;
}

export const ASSEMBLY_STEPS = ["Base", "Walls", "Load the parts", "Blocking and separators", "Lid"] as const;

interface AssemblyStep {
  n: number;
  title: (typeof ASSEMBLY_STEPS)[number];
  text: string;
  pieces: { piece: string; stock: string; cut: string; qty: number }[];
  screws: number;
}

export interface PrintableLabel {
  partId: string;
  partName: string;
  /** "4 PCS". */
  quantity: string;
  /** "297 LB" in the selected units, and the other units. */
  gross: string;
  grossOther: string;
  /** "CRATE A · 6 CRATES OF THIS TYPE" for a split batch, else null. */
  crate: string | null;
  outside: string;
  forkEntry: string;
  /** End view for the marks, in mm from the crate's outside bottom-left corner. */
  widthMm: number;
  heightMm: number;
  skidTallMm: number;
  skids: { y: number; w: number }[];
  /** The fork openings between the skids (`design.handling.openings`), where the entry arrows go. */
  openings: { y: number; w: number }[];
  /** The design's centre of gravity on the end view, from the bottom-left corner. */
  cogEnd: { y: number; z: number };
}

export interface PrintableCrate {
  /** "A" for the identical crates, "B" for the remainder. */
  letter: string;
  count: number;
  quantity: number;
  heading: string;
  spec: {
    rows: Row[];
    freight: Row[];
    layout: { chosen: string; why: string; runnerUp: string | null };
    checks: PrintableCheck[];
  };
  build: {
    drawings: Drawing[];
    /** "Dimensions in inches" or "Dimensions in mm". */
    dimsNote: string;
    cutList: CutGroup[];
    totals: Row[];
    fasteners: Fastener[];
    fastenerTotal: number;
    steps: AssemblyStep[];
  };
  label: PrintableLabel;
}

/** The quantity per crate and why (spec §7.16), when the document was made with the sweep. */
export interface PrintableQuantity {
  /** The crate on the page is the sweep's recommendation (its quantity and layout). */
  recommended: boolean;
  /** "Recommended: 34 per crate", or "20 per crate; the sweep recommends 34". */
  heading: string;
  /** The sweep's rationale: the score and what stopped a larger crate. */
  rationale: string;
  rows: Row[];
  /** "Costs use the shipped placeholder rates …", or null when the shop entered its own. */
  costNote: string | null;
}

/** The engine's stamp (spec §5.1), printed in the footer and the PDF's keywords. */
export interface PrintableStamp {
  engineVersion: string;
  inputHash: string;
}

export interface PrintableDesign {
  units: Units;
  unitsNote: string;
  title: string;
  /** "2026-11-16", as the clock read where the document was made (see `PrintableInput.timeZone`). */
  date: string;
  part: Row[];
  shipment: { split: boolean; text: string | null; rows: Row[]; unmet: string | null };
  crates: PrintableCrate[];
  /** Why there is no crate (spec §7.9), or null. */
  problem: string | null;
  /** The quantity rationale, when a sweep was given (the engine's PDF; not the /print route). */
  quantity?: PrintableQuantity | null;
  /** Set when the engine built the document. */
  stamp?: PrintableStamp;
  /** The ISO time the document was made: the PDF's creation date, so equal inputs give equal bytes. */
  createdAt?: string;
}

export interface PrintableInput {
  part: DesignPart & { massAssumed?: boolean };
  plan: ShipmentPlan;
  standards: ShopStandards;
  units: Units;
  /** How the plan was ranked; the "why this layout won" wording follows it. */
  ranking: Ranking;
  /** ISO timestamp; passed in so this stays pure. */
  generatedAt: string;
  /** IANA zone the document date is read in; this device's own zone when absent. */
  timeZone?: string;
  /** The part's quantity sweep (spec §7.16): adds the quantity rationale. */
  sweep?: QuantitySweep | null;
  /** The engine's stamp, when the engine builds the document. */
  stamp?: PrintableStamp;
}

const other = (u: Units): Units => (u === "imperial" ? "metric" : "imperial");
const withUnit = (mm: readonly number[], u: Units) => `${dims(mm, u)} ${lengthUnit(u)}`;
/** A spacing or other shop size with its unit: 11 13/16″ or 300 mm. */
const shopSize = (mm: number, u: Units) => (u === "imperial" ? cut(mm, u) : `${Math.round(mm)} mm`);

const LEVEL_TEXT: Record<Check["level"], PrintableCheck["levelText"]> = { ok: "Pass", caution: "Caution", info: "Info" };

/** The `explainLayout` result as a sentence, as the Layouts tab words it. */
function whyText(e: LayoutExplanation): string {
  switch (e.kind) {
    case "only":
      return "This is the only way to pack this batch under the current packing rules.";
    case "stable":
      return "The recommended layout is the smallest crate that will not tip easily.";
    case "smaller":
      return `The recommended layout is the smallest stable crate. The next option ships ${e.nextMorePct}% more volume.`;
    case "tie":
      return "The recommended layout is the lowest of the options that tie on shipping volume.";
    case "ranked":
      return e.by === "cost"
        ? "Ranked by crate cost: the recommended layout is the cheapest stable, fully blocked crate to build."
        : "Ranked by freight: the recommended layout has the lowest estimated freight class, then the lightest gross, of the stable, fully blocked crates without an LTL length charge.";
    case "picked":
      return `This layout was picked by hand. It ships ${e.morePct > 0 ? `${e.morePct}% more volume than` : "about the same volume as"} the recommended layout.`;
  }
}

const layoutText = (l: Layout, u: Units) => `${describeLayout(l)}, ${l.orientation.label.toLowerCase()}: ${withUnit(l.external, u)} outside`;

function runnerUp(layouts: Layout[], shown: Layout, u: Units): string | null {
  const next = layouts.find((l) => l.key !== shown.key);
  if (!next) return null;
  const pct = Math.round((next.externalVolumeM3 / shown.externalVolumeM3 - 1) * 100);
  const vol = pct > 0 ? `${pct}% more volume` : pct < 0 ? `${-pct}% less volume` : "about the same volume";
  return `${layoutText(next, u)}, ${volume(next.externalVolumeM3, u)}, ${vol}${next.stable ? "" : ", may tip"}.`;
}

/** The design's own LTL freight terms (spec §7.12), so the print and the Overview agree. */
function freightRows(design: CrateDesign, u: Units): Row[] {
  const f = design.freight;
  const imperial = u === "imperial";
  const dimText = imperial ? `${groupDigits(f.dimWeightLb)} lb` : `${groupDigits(Math.ceil(f.dimWeightLb / LB_PER_KG))} kg`;
  const grossWins = f.grossLb >= f.dimWeightLb;
  return [
    { label: "Dimensional weight", value: dimText, note: `L × W × H in inches ÷ ${f.dimDivisorIn3PerLb}` },
    {
      label: "Billable weight",
      value: grossWins ? weight(design.grossKg, u) : dimText,
      note: grossWins ? "the gross is higher" : "the dimensional weight is higher",
    },
    {
      label: "Density",
      value: `${f.densityLbFt3.toFixed(1)} lb/ft³`,
      note: imperial ? "gross ÷ outside volume, whole inches" : `${Math.round(design.grossKg / design.layout.externalVolumeM3)} kg/m³`,
    },
    { label: "Freight class", value: String(f.freightClass), note: "estimate from density (NMFC)" },
  ];
}

function cutList(design: CrateDesign, u: Units): CutGroup[] {
  const groups = new Map<string, CutGroup & { amount: number }>();
  for (const l of design.bom) {
    const stock = stockText(l, u);
    const g = groups.get(stock) ?? { stock, material: l.material, lines: [], pieces: 0, total: "", amount: 0 };
    g.lines.push({ piece: l.label, assembly: ASSEMBLY_NAMES[l.assembly], cut: cutText(l, u), qty: l.qty });
    g.pieces += l.qty;
    g.amount += l.material === "plywood" ? (l.cutMm[0] * l.cutMm[1] * l.qty) / 1e6 : (l.cutMm[0] * l.qty) / 1000;
    groups.set(stock, g);
  }
  return [...groups.values()].map(({ amount, ...g }) => ({ ...g, total: g.material === "plywood" ? area(amount, u) : run(amount, u) }));
}

const STEP_BASE = 0;
const STEP_WALLS = 1;
const STEP_LOAD = 2;
const STEP_BLOCKING = 3;
const STEP_LID = 4;

/**
 * The assembly step of a board. Base, walls and lid follow their assembly. Inside the crate,
 * bearers and the floor cradles go down before the parts are loaded; every other inside piece
 * (blocking, end stops, separators, stacking cradles) comes after. A stacking cradle is the
 * `cradle` member with the `stacking-cradle` variant.
 */
export function stepOfMember(m: Pick<Member, "assembly" | "kind" | "variant">): number {
  switch (m.assembly) {
    case "base":
      return STEP_BASE;
    case "sides":
    case "ends":
      return STEP_WALLS;
    case "lid":
      return STEP_LID;
    case "inside": {
      return m.kind === "bearer" || (m.kind === "cradle" && m.variant !== "stacking-cradle") ? STEP_LOAD : STEP_BLOCKING;
    }
  }
}

/** The screw lines that are driven before the parts go in; the other inside lines come after. */
const LOAD_STEP_SCREWS: readonly ScrewLine["id"][] = ["bearers", "cradles"];

function stepOfScrews(s: Pick<ScrewLine, "assembly" | "id">): number {
  if (s.assembly !== "inside") return stepOfMember({ assembly: s.assembly, kind: "blocking" });
  return LOAD_STEP_SCREWS.includes(s.id) ? STEP_LOAD : STEP_BLOCKING;
}

/** The part gap in the layout, from the slot spacing; null with one part per row and column. */
function partGap(layout: Layout): number | null {
  const [a, b] = layout.cellSize;
  const next = (axis: 0 | 1, size: number) => {
    const s0 = layout.slots[0];
    const s1 = layout.slots.find((s) => s.index[axis] === 1 && s.index[2] === 0);
    return s0 && s1 ? s1.min[axis] - s0.min[axis] - size : null;
  };
  return next(0, a) ?? next(1, b);
}

function steps(design: CrateDesign, schedule: ScrewLine[], u: Units): AssemblyStep[] {
  const { layout, construction: c, members } = design;
  const out: AssemblyStep[] = ASSEMBLY_STEPS.map((title, i) => ({ n: i + 1, title, text: "", pieces: [], screws: 0 }));
  // A cut-list line holds equal boards, so its first board gives the step of the line.
  const stepOfLine = new Map<string, number>();
  for (const m of members) if (!stepOfLine.has(m.bomKey)) stepOfLine.set(m.bomKey, stepOfMember(m));
  for (const l of design.bom) {
    out[stepOfLine.get(l.key) ?? STEP_BLOCKING].pieces.push({ piece: l.label, stock: stockText(l, u), cut: cutText(l, u), qty: l.qty });
  }
  for (const s of schedule) out[stepOfScrews(s)].screws += s.qty;

  const has = (kind: string) => members.some((m) => m.kind === kind);
  const [nx, ny, nz] = layout.counts;
  const gap = partGap(layout);
  const extW = layout.external[1];
  const skid = design.bom.find((l) => l.kind === "skid");
  const floor = design.bom.find((l) => l.kind === "floor");
  const separator = design.bom.find((l) => l.kind === "separator");
  const joist = design.bom.find((l) => l.kind === "joist");
  out[0].text =
    `Lay the ${c.skidCount} ${skid ? stockText(skid, u) : ""} skids along the length, evenly spread across the ${shopSize(extW, u)} width, ` +
    (c.joist && joist
      ? `screw ${c.joist.count} ${stockText(joist, u)} floor joists on edge across them, evenly spread along the length, and screw the ` +
        `${floor ? stockText(floor, u) : "plywood"} floor to the joists. `
      : `and screw the ${floor ? stockText(floor, u) : "plywood"} floor on top. `) +
    `The base is rated for ${weight(design.structure.ratedPayloadKg, u)} of parts. Forklift tines go between the skids from the ends.`;
  out[1].text =
    "Screw the rails and uprights to the outside of each side and end panel. Stand the side walls on the floor, fit the end walls " +
    "between them, then screw the walls to the floor and at the four corners.";
  const grid = nz > 1 ? `${nx} × ${ny} per layer, ${nz} layers` : `${nx} × ${ny}`;
  const cradles = members.filter((m) => m.kind === "cradle" && m.variant !== "stacking-cradle").length;
  const notch = members.find((m) => m.cradle?.notches.length)?.cradle?.notches[0];
  const notchText = !notch
    ? ""
    : notch.shape === "round"
      ? `Cut each notch as a round seat of ${shopSize(notch.radius, u)} radius, ${shopSize(notch.depth, u)} deep and ${shopSize(notch.width, u)} across, centred on each part. `
      : `Cut each notch as a flat pocket ${shopSize(notch.width, u)} wide and ${shopSize(notch.depth, u)} deep, centred on each part. `;
  out[2].text =
    (has("bearer") ? "Screw the bearers to the floor under each part position. " : "") +
    (cradles
      ? `Screw the ${cradles} notched cradles to the floor across the part positions, notches up, ` +
        `${cradles / layout.counts[longAxis(layout.cellSize)]} along each part. ${notchText}`
      : "") +
    `Set the ${layout.slots.length} parts ${layout.orientation.label.toLowerCase()} in a ${grid} grid` +
    `${gap !== null ? `, ${shopSize(gap, u)} apart` : ""}, ${shopSize(Math.min(layout.clearance[0], layout.clearance[1]), u)} or more from the walls` +
    `${nz > 1 ? ", starting with the bottom layer" : ""}.`;
  const stopsText = has("blocking")
    ? "Screw an end stop into the gap at each end of every part, from the floor to the top of the parts, so they can't slide along their length."
    : "No end stops: the gaps at the part ends are too small (see the blocking check).";
  out[3].text = cradles
    ? nz > 1
      ? "Set a stacking cradle over each floor cradle, notches down onto the layer below, load the next layer into its top notches, " +
        `and screw each stacking cradle through the side walls. ${stopsText}`
      : stopsText
    : !has("blocking")
      ? "No blocking posts: the gaps are too small to block (see the blocking check)."
      : nz > 1
        ? `Screw a blocking post into the gap on each side of every part. Lay a ${separator ? stockText(separator, u) : "plywood"} separator over each ` +
          "full layer, load the next layer on it, and block it the same way."
        : "Screw a blocking post into the gap on each side of every part, from the floor to the top of the part.";
  out[4].text = "Screw the edge and cross cleats to the lid panel, set the lid on the walls and screw it down around the top.";
  return out;
}

function label(design: CrateDesign, part: DesignPart, type: CrateType, split: boolean, u: Units): PrintableLabel {
  const { layout, construction: c, members } = design;
  const {
    min: [, y0, z0],
  } = memberBounds(members);
  const cog = design.handling.cogMm;
  return {
    partId: part.id,
    partName: part.name,
    quantity: `${type.quantity} PCS`,
    gross: weight(design.grossKg, u).toUpperCase(),
    grossOther: weight(design.grossKg, other(u)).toUpperCase(),
    crate: split ? `CRATE ${type.label} · ${type.count} ${type.count === 1 ? "CRATE" : "CRATES"} OF THIS TYPE` : null,
    outside: withUnit(layout.external, u),
    forkEntry: "Fork entry from the ends",
    widthMm: layout.external[1],
    heightMm: layout.external[2],
    skidTallMm: c.skid.tall,
    skids: members.filter((m) => m.kind === "skid").map((m) => ({ y: m.min[1] - y0, w: m.size[1] })),
    openings: design.handling.openings.map((o) => ({ y: o.y - y0, w: o.width })),
    cogEnd: { y: cog[1] - y0, z: cog[2] - z0 },
  };
}

function crateSection(input: PrintableInput, type: CrateType, split: boolean): PrintableCrate | null {
  const { part, standards, units: u } = input;
  const { design, layouts } = type.result;
  if (!design) return null;
  const { layout } = design;
  const schedule = screwSchedule(design.members, layout.interior, standards);
  const checks = allChecks(design.checks, { massAssumed: !!part.massAssumed }, null);
  const both = (kg: number): Row => ({ label: "", value: weight(kg, u), note: weight(kg, other(u)) });
  return {
    letter: type.label,
    count: type.count,
    quantity: type.quantity,
    heading: split ? `Crate ${type.label}: ${type.quantity} × ${part.name} · build ${type.count}` : `Crate for ${type.quantity} × ${part.name}`,
    spec: {
      rows: [
        { label: "Parts in the crate", value: `${type.quantity} × ${part.id}`, note: split ? `${type.count} of these crates` : undefined },
        { label: "Outside (L × W × H)", value: withUnit(layout.external, u), note: dimsOther(layout.external, u) },
        { ...both(design.grossKg), label: "Gross" },
        { ...both(design.tareKg), label: "Tare (empty crate)" },
        { ...both(design.payloadKg), label: "Payload" },
        { label: "Volume", value: volume(layout.externalVolumeM3, u), note: volume(layout.externalVolumeM3, other(u)) },
      ],
      freight: freightRows(design, u),
      layout: {
        chosen: `${layoutText(layout, u)}, ${volume(layout.externalVolumeM3, u)}`,
        why: whyText(explainLayout(layouts, layout, standards, input.ranking)),
        runnerUp: runnerUp(layouts, layout, u),
      },
      checks: checks.map((k) => ({ id: k.id, level: k.level, levelText: LEVEL_TEXT[k.level], title: k.title, detail: renderMessage(k.detail, u) })),
    },
    build: {
      drawings: crateDrawings(design, u),
      dimsNote: u === "imperial" ? "Dimensions in inches, to the nearest 1/16″" : "Dimensions in mm",
      cutList: cutList(design, u),
      totals: [
        { label: "Plywood", value: area(design.plywoodM2, u) },
        { label: "Lumber", value: run(design.lumberM, u) },
        { label: "Wood screws", value: `~${design.screws}` },
      ],
      fasteners: schedule.map((s) => ({
        title: s.title,
        rule: s.everyMm === null ? s.rule : `1 every ${shopSize(s.everyMm, u)} ${s.rule}`,
        qty: s.qty,
      })),
      fastenerTotal: schedule.reduce((n, s) => n + s.qty, 0),
      steps: steps(design, schedule, u),
    },
    label: label(design, part, type, split, u),
  };
}

/** The hard rule that stopped a crate, in a few words (spec §7.16). */
export const CONSTRAINT_TEXT: Record<SweepConstraint, string> = {
  door: "trailer door and floor",
  stable: "stability",
  blocking: "room to block the parts",
  "base-rating": "base rating",
  "max-gross": "per-crate gross limit",
  "max-parts": "per-crate part limit",
};

/** Said wherever a crate cost is shown while the cost inputs are the shipped placeholders. */
export const PLACEHOLDER_COST_NOTE =
  "Costs use the shipped placeholder wood and screw prices and shop times (shop standards): good for comparing designs, not for a quote.";

/** True when the plan's crate is the sweep's recommendation: its quantity and its layout, in one crate type. */
export function isRecommended(plan: ShipmentPlan, sweep: QuantitySweep | null | undefined): boolean {
  const rec = sweep?.recommendation;
  const design = plan.crates[0]?.result.design;
  return !!rec && !!design && !plan.split && plan.totals.parts === rec.quantity && design.layout.key === rec.crate.layoutKey;
}

/** The quantity section: the recommendation, its rationale and the constraint that stopped a larger crate. */
function quantitySection(plan: ShipmentPlan, sweep: QuantitySweep, standards: ShopStandards, u: Units): PrintableQuantity | null {
  const rec = sweep.recommendation;
  if (!rec || plan.problem) return null;
  const recommended = isRecommended(plan, sweep);
  const here = plan.split ? plan.crates.map((c) => c.quantity).join(" and ") : String(plan.totals.parts);
  const { stoppedBy } = rec;
  const rows: Row[] = [
    { label: "Recommended", value: `${rec.quantity} per crate`, note: `${usdCents(rec.crate.scoreUsdPerPart)} a part in crate cost` },
    stoppedBy
      ? {
          label: "Stopped a larger crate",
          value: `${stoppedBy.quantity} per crate fails the ${CONSTRAINT_TEXT[stoppedBy.binding]}`,
          note: renderMessage(stoppedBy.reason, u),
        }
      : { label: "Stopped a larger crate", value: `Nothing up to ${sweep.maxQuantity} per crate` },
    {
      label: "Freight",
      value: sweep.basis === "crate-only" ? "Not priced" : "Priced from the given rates",
      note: sweep.basis === "crate-only" ? "No freight rates were given, so the score is crate cost per part." : undefined,
    },
  ];
  return {
    recommended,
    heading: recommended ? `Recommended: ${rec.quantity} per crate` : `${here} per crate; the sweep recommends ${rec.quantity}`,
    rationale: renderMessage(rec.rationale, u),
    rows,
    costNote: costsArePlaceholder(standards) ? PLACEHOLDER_COST_NOTE : null,
  };
}

/** The whole hand-off document for a plan, in the selected units. Pure. */
export function buildPrintable(input: PrintableInput): PrintableDesign {
  const { part, plan, units: u, generatedAt, timeZone } = input;
  const { totals, split } = plan;
  const crates = plan.crates.map((t) => crateSection(input, t, split)).filter((c): c is PrintableCrate => c !== null);
  return {
    units: u,
    unitsNote: u === "imperial" ? "Inches and pounds; cuts to the nearest 1/16″, lumber by nominal size" : "Millimetres and kilograms",
    title: split ? `Shipment of ${totals.parts} × ${part.name}` : `Crate for ${totals.parts} × ${part.name}`,
    date: documentDate(generatedAt, timeZone),
    part: [
      { label: "Part", value: part.id },
      { label: "Name", value: part.name },
      { label: "Material", value: part.material ?? "not given" },
      { label: "Mass each", value: weight(part.mass_kg, u), note: weight(part.mass_kg, other(u)) },
      { label: "Quantity", value: String(totals.parts) },
    ],
    shipment: {
      split,
      text: split ? `Ships as ${describeShipment(plan)}` : null,
      rows: split
        ? [
            { label: "Crates", value: String(totals.crates) },
            { label: "Parts", value: String(totals.parts) },
            { label: "Gross, all crates", value: weight(totals.grossKg, u), note: weight(totals.grossKg, other(u)) },
            { label: "Volume, all crates", value: volume(totals.volumeM3, u), note: volume(totals.volumeM3, other(u)) },
          ]
        : [],
      unmet: plan.unmet && renderMessage(plan.unmet, u),
    },
    crates,
    problem: plan.problem ? `${plan.problem.title}. ${renderMessage(plan.problem.detail, u)}` : null,
    ...(input.sweep ? { quantity: quantitySection(plan, input.sweep, input.standards, u) } : {}),
    ...(input.stamp ? { stamp: { engineVersion: input.stamp.engineVersion, inputHash: input.stamp.inputHash }, createdAt: generatedAt } : {}),
  };
}

export type PrintableFromFile = { ok: true; doc: PrintableDesign; notes: string[] } | { ok: false; error: string };

/**
 * The document for a saved design file (§6.5), rebuilt with `standards` the way reopening the
 * file does. The part comes from the file itself (its size, mass and measured outline), and so
 * does the ranking, so the print is the crate that was saved and a custom part needs no model
 * to print. `notes` say, in `units`, what came out differently from the saved summary.
 */
export function printableFromDesignFile(text: string, standards: ShopStandards, units: Units, generatedAt: string, timeZone?: string): PrintableFromFile {
  const parsed = parseDesignFile(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { file } = parsed;
  const p = file.part;
  const part = {
    id: p.id,
    name: p.name,
    material: p.material,
    mass_kg: p.mass_kg,
    dimensions_mm: p.dimensions_mm,
    massAssumed: p.massAssumed,
    profile: fileProfile(file),
  };
  const { ranking } = file;
  const plan = planShipment(part, file.settings, file.layoutKey, standards, ranking);
  const { notes } = restoreDesign(file, part, standards);
  return {
    ok: true,
    doc: buildPrintable({ part, plan, standards, units, ranking, generatedAt, timeZone }),
    notes: notes.map((n: Message) => renderMessage(n, units)),
  };
}

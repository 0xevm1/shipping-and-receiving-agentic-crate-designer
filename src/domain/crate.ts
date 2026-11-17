import { crateCost, estimateLabour, freightTerms, type CrateCost, type FreightTerms, type LabourEstimate } from "./cost";
import { analyseHandling, handlingChecks, type Handling } from "./handling";
import type { Layout } from "./packing";
import type { CrateSettings, DesignPart, Vec3 } from "./schema";
import { DEFAULT_STANDARDS, minInteriorMm, type ShopStandards } from "./standards";

/**
 * Turns a packing layout into a buildable wooden crate: every board as an
 * axis-aligned box, plus a cut list, weights, fastener count and warnings.
 *
 * Coordinates: interior min corner at the origin (top face of the floor), Z up,
 * X along the crate's length (skids run along X, forklift entry from the ends).
 */

// Every size, threshold, limit and rate comes from the shop standards (standards.ts).

/**
 * Smallest interior on any axis with the default standards: room for the top and
 * bottom rails of a wall (and the two lid edge cleats) without them overlapping or
 * overhanging. Only very small parts hit it; the packer pads their crate up to it.
 * Designs use `minInteriorMm(standards)`.
 */
export const MIN_INTERIOR_MM = minInteriorMm(DEFAULT_STANDARDS);

export type MemberKind =
  | "skid"
  | "floor"
  | "side"
  | "end"
  | "lid"
  | "cleat"
  | "lid-cleat"
  | "separator"
  | "bearer"
  | "blocking";

export type WoodMaterial = "plywood" | "lumber";

/** The sub-assemblies a carpenter builds, in build order. The cut list groups by these. */
export const ASSEMBLIES = ["base", "sides", "ends", "lid", "inside"] as const;
export type Assembly = (typeof ASSEMBLIES)[number];

/**
 * Which face of the crate a board belongs to, so the viewer can move it when
 * exploded or fade it when opened. `side-` is the front (−Y) wall.
 */
export type Face = "base" | "side-" | "side+" | "end-" | "end+" | "lid" | "inside";

export interface Member {
  kind: MemberKind;
  material: WoodMaterial;
  assembly: Assembly;
  face: Face;
  /** Shop name for the piece, e.g. "Side rail". */
  label: string;
  /** Key of the cut-list line this board belongs to. */
  bomKey: string;
  min: Vec3;
  size: Vec3;
}

export interface Construction {
  panelMm: number;
  floorMm: number;
  skid: { wide: number; tall: number };
  /** Cleat section for the wall and lid frames. */
  cleat: { thick: number; wide: number };
  skidCount: number;
}

export interface BomLine {
  /** Unique per line; equals `bomKey` on its members. */
  key: string;
  assembly: Assembly;
  label: string;
  kind: MemberKind;
  material: WoodMaterial;
  /** e.g. "19 × 89" lumber section or "12 mm" plywood. */
  stock: string;
  /** Cut size: length for lumber, L × W for plywood. */
  cut: string;
  /** Stock in mm: [thickness] for plywood, [thickness, width] for lumber. */
  stockMm: number[];
  /** Cut in mm: [length] for lumber, [length, width] for plywood. */
  cutMm: number[];
  qty: number;
}

export interface Check {
  id:
    | "door"
    | "oversize"
    | "blocking"
    | "stack"
    | "stable"
    | "base-rating"
    | "cog-offset"
    | "cog-tip"
    | "forklift"
    | "pallet-jack"
    | "utilization"
    | "cardboard"
    | "crate-limit";
  /** `ok` = rule passed, `caution` = needs attention, `info` = worth knowing. */
  level: "ok" | "caution" | "info";
  title: string;
  detail: string;
}

export interface CrateDesign {
  layout: Layout;
  construction: Construction;
  members: Member[];
  bom: BomLine[];
  payloadKg: number;
  tareKg: number;
  /** Empty-crate weight split by sub-assembly; sums to `tareKg`. */
  tareKgByAssembly: Record<Assembly, number>;
  grossKg: number;
  plywoodM2: number;
  lumberM: number;
  screws: number;
  /** Plywood and lumber only (`rates.costUsdPerM3`); `cost` adds screws and labour. */
  materialCostUsd: number;
  /** Build time and labour cost (#17, spec §7.12). */
  labour: LabourEstimate;
  /** Wood + screws + labour (#17). */
  cost: CrateCost;
  /** Domestic LTL terms: gross lb, volume, dimensional weight, density and estimated class (#17). */
  freight: FreightTerms;
  /** `freight.freightClass`, at the top level for exports and the build sheet (#26). */
  freightClass: number;
  /** `freight.densityLbFt3`. */
  densityLbFt3: number;
  /** `freight.dimWeightLb`. */
  dimWeightLb: number;
  /**
   * Combined centre of gravity of the crate and the parts (#8, spec §7.14), in the crate-interior
   * frame of `members` (origin at the interior min corner, on top of the floor; Z up).
   */
  centerOfGravityMm: Vec3;
  /** Centre of gravity, tip angle and fork openings (#8, `handling.ts`). */
  handling: Handling;
  /** Every rule, passed or not, in a fixed order. */
  checks: Check[];
}

/** Choose board sizes from payload mass, using the shop's stock and thresholds. */
export function resolveConstruction(
  settings: CrateSettings,
  payloadKg: number,
  standards: ShopStandards = DEFAULT_STANDARDS,
): Omit<Construction, "skidCount"> {
  const { stock, construction: rule } = standards;
  const ply = stock.panelPlywoodMm;
  const panelMm =
    settings.panelThickness !== "auto"
      ? settings.panelThickness
      : payloadKg <= rule.panelLightMaxKg
        ? ply.light
        : payloadKg <= rule.panelMediumMaxKg
          ? ply.medium
          : ply.heavy;
  const skid = payloadKg <= rule.heavySkidOverKg ? stock.skidMm.standard : stock.skidMm.heavy;
  return { panelMm, floorMm: stock.floorPlywoodMm, skid: { ...skid }, cleat: { ...stock.cleatMm } };
}

/** What the structure adds to the interior on each axis — fed to the packer. */
export function structureAllowance(c: Omit<Construction, "skidCount">): Vec3 {
  const wall = 2 * (c.panelMm + c.cleat.thick);
  return [wall, wall, c.skid.tall + c.floorMm + c.panelMm + c.cleat.thick];
}

export function designCrate(
  part: DesignPart,
  settings: CrateSettings,
  layout: Layout,
  standards: ShopStandards = DEFAULT_STANDARDS,
): CrateDesign {
  const payloadKg = part.mass_kg * settings.quantity;
  const base = resolveConstruction(settings, payloadKg, standards);
  const t = base.panelMm;
  const ct = base.cleat.thick;
  const cw = base.cleat.wide;
  const [L, W, H] = layout.interior;
  const extW = W + 2 * (t + ct);
  const skidCount = Math.max(2, Math.ceil(extW / standards.construction.skidSpacingMm) + 1);
  const verticalCount = (span: number) => Math.max(2, Math.ceil(span / standards.construction.maxCleatSpacingMm) + 1);
  const construction: Construction = { ...base, skidCount };

  const members: Member[] = [];
  const add: AddMember = (kind, material, tag, min, size) => {
    if (size.every((s) => s > 0.5)) members.push({ kind, material, ...tag, bomKey: "", min, size });
  };

  // Base: floor sheet over the full footprint, skids underneath.
  const x0 = -t - ct;
  const y0 = -t - ct;
  const extL = L + 2 * (t + ct);
  const baseTag = (label: string): Tag => ({ assembly: "base", face: "base", label });
  add("floor", "plywood", baseTag("Floor"), [x0, y0, -base.floorMm], [extL, extW, base.floorMm]);
  const skidZ = -base.floorMm - base.skid.tall;
  spread(y0, extW, base.skid.wide, skidCount).forEach((y) =>
    add("skid", "lumber", baseTag("Skid"), [x0, y, skidZ], [extL, base.skid.wide, base.skid.tall]),
  );

  // Long side walls (−Y and +Y). Panels run the full outside length of the end walls.
  for (const side of [-1, 1] as const) {
    const panelY = side < 0 ? -t : W;
    const cleatY = side < 0 ? -t - ct : W + t;
    const tag = (label: string): Tag => ({ assembly: "sides", face: side < 0 ? "side-" : "side+", label });
    add("side", "plywood", tag("Side panel"), [-t, panelY, 0], [L + 2 * t, t, H]);
    // Perimeter frame + intermediate verticals.
    add("cleat", "lumber", tag("Side rail"), [-t, cleatY, 0], [L + 2 * t, ct, cw]);
    add("cleat", "lumber", tag("Side rail"), [-t, cleatY, H - cw], [L + 2 * t, ct, cw]);
    spread(-t, L + 2 * t, cw, verticalCount(L + 2 * t)).forEach((x) =>
      add("cleat", "lumber", tag("Side upright"), [x, cleatY, cw], [cw, ct, H - 2 * cw]),
    );
  }

  // End walls (−X and +X). Their cleats wrap the corners over the side cleats.
  for (const side of [-1, 1] as const) {
    const panelX = side < 0 ? -t : L;
    const cleatX = side < 0 ? -t - ct : L + t;
    const tag = (label: string): Tag => ({ assembly: "ends", face: side < 0 ? "end-" : "end+", label });
    add("end", "plywood", tag("End panel"), [panelX, 0, 0], [t, W, H]);
    add("cleat", "lumber", tag("End rail"), [cleatX, y0, 0], [ct, extW, cw]);
    add("cleat", "lumber", tag("End rail"), [cleatX, y0, H - cw], [ct, extW, cw]);
    spread(y0, extW, cw, verticalCount(extW)).forEach((y) =>
      add("cleat", "lumber", tag("End upright"), [cleatX, y, cw], [ct, cw, H - 2 * cw]),
    );
  }

  // Lid: panel plus a cleat frame on top, screwed down (removable for unpacking).
  const lidTag = (label: string): Tag => ({ assembly: "lid", face: "lid", label });
  add("lid", "plywood", lidTag("Lid panel"), [-t, -t, H], [L + 2 * t, W + 2 * t, t]);
  add("lid-cleat", "lumber", lidTag("Lid edge cleat"), [-t, -t, H + t], [L + 2 * t, cw, ct]);
  add("lid-cleat", "lumber", lidTag("Lid edge cleat"), [-t, W + t - cw, H + t], [L + 2 * t, cw, ct]);
  spread(-t, L + 2 * t, cw, verticalCount(L + 2 * t)).forEach((x) =>
    add("lid-cleat", "lumber", lidTag("Lid cross cleat"), [x, -t + cw, H + t], [cw, W + 2 * t - 2 * cw, ct]),
  );

  addDunnage(layout, settings, t, standards, add);

  const bom = buildBom(members);
  const density = standards.rates.densityKgM3;
  const volumes = { plywood: 0, lumber: 0 };
  const tareKgByAssembly: Record<Assembly, number> = { base: 0, sides: 0, ends: 0, lid: 0, inside: 0 };
  let plywoodM2 = 0;
  let lumberM = 0;
  for (const m of members) {
    const volumeM3 = (m.size[0] * m.size[1] * m.size[2]) / 1e9;
    volumes[m.material] += volumeM3;
    tareKgByAssembly[m.assembly] += volumeM3 * density[m.material];
    const sorted = [...m.size].sort((p, q) => q - p);
    if (m.material === "plywood") plywoodM2 += (sorted[0] * sorted[1]) / 1e6;
    else lumberM += sorted[0] / 1000;
  }
  const tareKg = volumes.plywood * density.plywood + volumes.lumber * density.lumber;
  const cost = standards.rates.costUsdPerM3;
  const materialCostUsd = volumes.plywood * cost.plywood + volumes.lumber * cost.lumber;
  const screws = estimateScrews(members, layout.interior, standards);
  const grossKg = payloadKg + tareKg;
  const labour = estimateLabour(bom, screws, layout.counts[2], standards);
  const freight = freightTerms(grossKg, layout.external, standards);
  // Read-only over the finished members and part placements (#8).
  const handling = analyseHandling(members, layout, part.mass_kg, standards);

  const design: CrateDesign = {
    layout,
    construction,
    members,
    bom,
    payloadKg,
    tareKg,
    tareKgByAssembly,
    grossKg,
    plywoodM2,
    lumberM,
    screws,
    materialCostUsd,
    labour,
    cost: crateCost(materialCostUsd, screws, labour.costUsd, standards),
    freight,
    freightClass: freight.freightClass,
    densityLbFt3: freight.densityLbFt3,
    dimWeightLb: freight.dimWeightLb,
    centerOfGravityMm: handling.cogMm,
    handling,
    checks: [],
  };
  design.checks = evaluateChecks(design, part, settings, standards);
  return design;
}

/**
 * Internal wooden dunnage that holds the parts in place:
 * - bearers lift the bottom layer off the floor by the wall clearance,
 * - plywood separators between layers,
 * - blocking posts in every gap around each part, running floor-to-separator
 *   so they also carry the layer above.
 */
function addDunnage(
  layout: Layout,
  settings: CrateSettings,
  separatorMm: number,
  standards: ShopStandards,
  add: AddMember,
) {
  const blockWidth = standards.stock.blockWidthMm;
  const minBlockingGap = standards.construction.minBlockingGapMm;
  const [L, W] = layout.interior;
  const [a, b, c] = layout.cellSize;
  const [, , nz] = layout.counts;
  const gap = settings.partGapMm;
  // Per-axis clearance: the setting, or more where a tiny part's crate was padded.
  const [clearX, clearY, clearZ] = layout.clearance;
  const layerBase = (k: number) => clearZ + k * (c + gap + separatorMm);

  for (let k = 1; k < nz; k++) {
    add("separator", "plywood", insideTag("Layer separator"), [0, 0, layerBase(k) - separatorMm], [L, W, separatorMm]);
  }

  const placed = new Set<string>();
  const block = (min: Vec3, size: Vec3, kind: "blocking" | "bearer" = "blocking") => {
    const key = [...min, ...size].map((v) => Math.round(v)).join(",");
    if (placed.has(key)) return;
    placed.add(key);
    add(kind, "lumber", insideTag(kind === "bearer" ? "Bearer" : "Blocking post"), min, size);
  };

  for (const slot of layout.slots) {
    const [x, y, z] = slot.min;
    const k = slot.index[2];
    const floorZ = k === 0 ? 0 : layerBase(k);
    const topZ = k < nz - 1 ? layerBase(k + 1) - separatorMm : z + c;
    const h = topZ - floorZ;

    if (k === 0 && clearZ > 0) {
      for (const fy of [0.2, 0.8]) {
        // Kept inside the walls when the side clearance is too small for a centred strip.
        const by = Math.min(W - blockWidth, Math.max(0, y + b * fy - blockWidth / 2));
        block([x, by, 0], [a, blockWidth, clearZ], "bearer");
      }
    }

    // Gap on each side: to the wall (clearance) or to the neighbour (part gap).
    const [i, j] = slot.index;
    const [nx, ny] = layout.counts;
    const gx0 = i === 0 ? clearX : gap;
    const gx1 = i === nx - 1 ? clearX : gap;
    const gy0 = j === 0 ? clearY : gap;
    const gy1 = j === ny - 1 ? clearY : gap;
    const bwx = Math.min(blockWidth, a);
    const bwy = Math.min(blockWidth, b);
    const cx = x + a / 2 - bwx / 2;
    const cy = y + b / 2 - bwy / 2;
    if (gx0 >= minBlockingGap) block([x - gx0, cy, floorZ], [gx0, bwy, h]);
    if (gx1 >= minBlockingGap) block([x + a, cy, floorZ], [gx1, bwy, h]);
    if (gy0 >= minBlockingGap) block([cx, y - gy0, floorZ], [bwx, gy0, h]);
    if (gy1 >= minBlockingGap) block([cx, y + b, floorZ], [bwx, gy1, h]);
  }
}

type Tag = Pick<Member, "assembly" | "face" | "label">;
type AddMember = (kind: MemberKind, material: WoodMaterial, tag: Tag, min: Vec3, size: Vec3) => void;

function insideTag(label: string): Tag {
  return { assembly: "inside", face: "inside", label };
}

/** `count` evenly spaced start positions for boards of `width` across [start, start + span]. */
function spread(start: number, span: number, width: number, count: number): number[] {
  if (count <= 1) return [start];
  const step = (span - width) / (count - 1);
  return Array.from({ length: count }, (_, i) => start + i * step);
}

/** Groups members into cut-list lines by assembly, piece name, stock and cut, and links each member to its line. */
function buildBom(members: Member[]): BomLine[] {
  const lines = new Map<string, BomLine>();
  for (const m of members) {
    const s = [...m.size].map((v) => Math.round(v)).sort((p, q) => q - p);
    const plywood = m.material === "plywood";
    const stockMm = plywood ? [s[2]] : [s[2], s[1]];
    const cutMm = plywood ? [s[0], s[1]] : [s[0]];
    const stock = plywood ? `${s[2]} mm` : `${s[2]} × ${s[1]}`;
    const cut = cutMm.join(" × ");
    const key = `${m.assembly}|${m.label}|${stock}|${cut}`;
    m.bomKey = key;
    const line = lines.get(key);
    if (line) line.qty++;
    else {
      const { assembly, label, kind, material } = m;
      lines.set(key, { key, assembly, label, kind, material, stock, cut, stockMm, cutMm, qty: 1 });
    }
  }
  return [...lines.values()];
}

/** One line of the fastener schedule (#26): where the screws go, how they are spaced, how many. */
export interface ScrewLine {
  id: "skids" | "side-cleats" | "end-cleats" | "walls-to-floor" | "corners" | "bearers" | "blocking" | "lid-cleats" | "lid-to-walls";
  /** The sub-assembly the screws are driven in, for the build order. */
  assembly: Assembly;
  /** "Floor to skids". */
  title: string;
  /** Spacing rule; the spacing in mm (null for a fixed count per piece). */
  everyMm: number | null;
  /** "along each skid, plus 1", "per bearer". */
  rule: string;
  qty: number;
}

/**
 * The screw estimate line by line (spec §7.6), at the standard spacings (`rates.screwSpacingMm`;
 * defaults: cleats every 150 mm, panel joints every 200 mm, skids every 300 mm), plus 2 per
 * block or bearer. `CrateDesign.screws` is the sum. Lines with no screws are left out.
 */
export function screwSchedule(members: Member[], interior: Vec3, standards: ShopStandards = DEFAULT_STANDARDS): ScrewLine[] {
  const [L, W, H] = interior;
  const every = standards.rates.screwSpacingMm;
  const along = (match: (m: Member) => boolean, spacing: number) =>
    members.filter(match).reduce((n, m) => n + Math.ceil(Math.max(...m.size) / spacing) + 1, 0);
  const count = (kind: MemberKind) => members.filter((m) => m.kind === kind).length;
  const joint = Math.ceil((2 * (L + W)) / every.panelJoint);
  const cleatOf = (a: Assembly) => (m: Member) => (m.kind === "cleat" || m.kind === "lid-cleat") && m.assembly === a;
  const lines: ScrewLine[] = [
    { id: "skids", assembly: "base", title: "Floor to skids", everyMm: every.skid, rule: "along each skid, plus 1", qty: along((m) => m.kind === "skid", every.skid) },
    { id: "side-cleats", assembly: "sides", title: "Side wall cleats to panels", everyMm: every.cleat, rule: "along each cleat, plus 1", qty: along(cleatOf("sides"), every.cleat) },
    { id: "end-cleats", assembly: "ends", title: "End wall cleats to panels", everyMm: every.cleat, rule: "along each cleat, plus 1", qty: along(cleatOf("ends"), every.cleat) },
    { id: "walls-to-floor", assembly: "sides", title: "Walls to floor", everyMm: every.panelJoint, rule: "around the base", qty: joint },
    { id: "corners", assembly: "sides", title: "Wall corners", everyMm: every.panelJoint, rule: "up each of the 4 corners", qty: Math.ceil(H / every.panelJoint) * 4 },
    { id: "bearers", assembly: "inside", title: "Bearers to floor", everyMm: null, rule: "2 per bearer", qty: count("bearer") * 2 },
    { id: "blocking", assembly: "inside", title: "Blocking posts", everyMm: null, rule: "2 per post", qty: count("blocking") * 2 },
    { id: "lid-cleats", assembly: "lid", title: "Lid cleats to lid panel", everyMm: every.cleat, rule: "along each cleat, plus 1", qty: along(cleatOf("lid"), every.cleat) },
    { id: "lid-to-walls", assembly: "lid", title: "Lid to walls", everyMm: every.panelJoint, rule: "around the top", qty: joint },
  ];
  return lines.filter((l) => l.qty > 0);
}

/** Total wood screws: the sum of `screwSchedule`. */
function estimateScrews(members: Member[], interior: Vec3, standards: ShopStandards): number {
  return screwSchedule(members, interior, standards).reduce((n, l) => n + l.qty, 0);
}

/** The default 53' dry van limits (`limits.trailerMm`); the checks read the standards. */
export const DRY_VAN_53FT_MM = DEFAULT_STANDARDS.limits.trailerMm;

/** The default LTL excessive-length threshold (`limits.ltlExcessiveLengthMm`). */
export const LTL_EXCESSIVE_LENGTH_MM = DEFAULT_STANDARDS.limits.ltlExcessiveLengthMm;

/** The default carton limits (`limits.cardboard`). */
export const CARDBOARD_LIMITS = DEFAULT_STANDARDS.limits.cardboard;

/** Actual -> nominal US lumber size in inches, for naming sections ("4×4"). */
const NOMINAL_IN: Record<number, number> = { 19: 1, 38: 2, 64: 3, 89: 4, 140: 6, 184: 8, 235: 10, 286: 12 };

/** "4×6" for standard US lumber, otherwise the actual size in mm. */
function sectionName(a: number, b: number): string {
  const [na, nb] = [NOMINAL_IN[a], NOMINAL_IN[b]];
  return na && nb ? `${na}×${nb}` : `${a} × ${b} mm`;
}

/**
 * The narrowest gap beside a part in the drawn crate, where blocking posts go: the
 * per-axis wall clearance (larger than the setting when a tiny crate was padded), and
 * the part gap only on an axis with more than one part.
 */
function smallestSideGap(layout: Layout, partGapMm: number): { mm: number; where: string } {
  const [nx, ny] = layout.counts;
  const [clearX, clearY] = layout.clearance;
  const gaps = [
    ...(nx > 1 || ny > 1 ? [{ mm: partGapMm, where: "between parts" }] : []),
    clearX === clearY ? { mm: clearX, where: "to the walls" } : { mm: clearX, where: "to the end walls" },
    ...(clearX === clearY ? [] : [{ mm: clearY, where: "to the side walls" }]),
  ];
  return gaps.reduce((a, b) => (b.mm < a.mm ? b : a));
}

/** Every rule of thumb, reported whether it passes or not. Order is fixed; the UI sorts. */
function evaluateChecks(d: CrateDesign, part: DesignPart, settings: CrateSettings, standards: ShopStandards): Check[] {
  const checks: Check[] = [];
  const lim = standards.limits;
  const minBlockingGap = standards.construction.minBlockingGapMm;
  const [eL, eW, eH] = d.layout.external;
  const nz = d.layout.counts[2];

  const van = lim.trailerMm;
  const mm = (v: number) => `${v.toLocaleString("en-US")} mm`;
  const tooBig = [
    eL > van.interiorLength && `Length is over the ${mm(van.interiorLength)} trailer floor.`,
    eW > van.doorWidth && `Width is over the ${mm(van.doorWidth)} door opening.`,
    eH > van.doorHeight && `Height is over the ${mm(van.doorHeight)} door opening.`,
  ].filter((s): s is string => !!s);
  checks.push(
    tooBig.length
      ? { id: "door", level: "caution", title: "Too big for a 53' dry van", detail: `${tooBig.join(" ")} Confirm open-deck or oversize transport with the carrier.` }
      : { id: "door", level: "ok", title: "Fits a 53' dry van", detail: `Within the ${mm(van.doorWidth)} × ${mm(van.doorHeight)} door and the ${mm(van.interiorLength)} floor.` },
  );

  const ratio = eH / Math.min(eL, eW);
  checks.push(
    d.layout.stable
      ? { id: "stable", level: "ok", title: "Stable footprint", detail: `Height is ${ratio.toFixed(2)}× the short side. The limit is ${lim.stableHeightRatio}×.` }
      : { id: "stable", level: "caution", title: "Tip-over risk", detail: `Height is ${ratio.toFixed(2)}× the short side, over the ${lim.stableHeightRatio}× limit. Strap it down or pick a lower layout.` },
  );

  const posts = d.members.filter((m) => m.kind === "blocking").length;
  const tightest = smallestSideGap(d.layout, settings.partGapMm);
  const betweenParts = tightest.where === "between parts";
  const gapText = `${Math.round(tightest.mm)} mm ${betweenParts ? "gap" : "clearance"} ${tightest.where}`;
  checks.push(
    tightest.mm < minBlockingGap
      ? { id: "blocking", level: "caution", title: "Parts are not restrained", detail: `The ${gapText} is under the ${minBlockingGap} mm that blocking needs. Widen ${betweenParts ? "the gap between parts" : "the clearance to walls"}.` }
      : { id: "blocking", level: "ok", title: "Every part is blocked in", detail: `${posts} blocking posts hold the parts on all four sides. The smallest gap is ${Math.round(tightest.mm)} mm, ${tightest.where}.` },
  );

  if (nz > 1) {
    const stackedKg = part.mass_kg * (nz - 1);
    checks.push(
      stackedKg > lim.stackKg
        ? { id: "stack", level: "caution", title: "Heavy stack on the bottom layer", detail: `Each bottom position carries ${Math.round(stackedKg)} kg from above. Consider fewer layers.` }
        : { id: "stack", level: "ok", title: "Stack load is light", detail: `Each bottom position carries ${Math.round(stackedKg)} kg from above. The limit is ${lim.stackKg} kg.` },
    );
  }

  const skidName = sectionName(d.construction.skid.wide, d.construction.skid.tall);
  const rating = `${lim.baseRatingKg.toLocaleString("en-US")} kg`;
  checks.push(
    d.grossKg > lim.baseRatingKg
      ? { id: "base-rating", level: "caution", title: `Over ${rating} gross`, detail: "Needs heavier skids and floor joists than this design includes." }
      : { id: "base-rating", level: "ok", title: "Within the standard base rating", detail: `Gross weight is under ${rating}, so ${skidName} skids and a ${d.construction.floorMm} mm floor are enough.` },
  );

  checks.push(...handlingChecks(d.handling, standards));

  if (eL > lim.ltlExcessiveLengthMm) {
    const ft = Math.round((lim.ltlExcessiveLengthMm / 304.8) * 10) / 10;
    checks.push({ id: "oversize", level: "info", title: "LTL length surcharge likely", detail: `Length is over ${mm(lim.ltlExcessiveLengthMm)} (${ft} ft). Most LTL carriers add an excessive-length charge.` });
  }
  if (d.layout.utilization < lim.lowUtilization) {
    checks.push({ id: "utilization", level: "info", title: "Mostly empty space", detail: "Parts are packed by their bounding box, so irregular shapes leave air. A nested layout could be smaller." });
  }
  const [iL, iW, iH] = d.layout.interior;
  const box = lim.cardboard;
  if (part.mass_kg <= box.partKg && d.payloadKg <= box.payloadKg && iL + iW + iH <= box.boxDimSumMm) {
    checks.push({
      id: "cardboard",
      level: "info",
      title: "A cardboard box may be enough",
      detail: `${Math.round(d.payloadKg * 10) / 10} kg in a ${[iL, iW, iH].map(Math.round).join(" × ")} mm space is within what a 32 ECT single-wall carton is rated for (29.5 kg gross, ${mm(box.boxDimSumMm)} L + W + H). The crate design is still here if you want one.`,
    });
  }
  return checks;
}

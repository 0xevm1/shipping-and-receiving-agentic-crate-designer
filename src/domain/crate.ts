import { STABLE_HEIGHT_RATIO, type Layout } from "./packing";
import type { CrateSettings, DesignPart, Vec3 } from "./schema";

/**
 * Turns a packing layout into a buildable wooden crate: every board as an
 * axis-aligned box, plus a cut list, weights, fastener count and warnings.
 *
 * Coordinates: interior min corner at the origin (top face of the floor), Z up,
 * X along the crate's length (skids run along X, forklift entry from the ends).
 */

// Nominal US lumber, actual dimensions in mm.
const CLEAT = { thick: 19, wide: 89 }; // 1x4
const BLOCK_WIDTH = 89; // blocking cut from 2x4 / 4x4 stock
const FLOOR_THICKNESS = 19;
const MAX_CLEAT_SPACING = 600;
const MIN_BLOCKING_GAP = 19;
/**
 * Smallest interior on any axis: room for the top and bottom rails of a wall
 * (and the two lid edge cleats) without them overlapping or overhanging.
 * Only very small parts hit it; the packer pads their crate up to this.
 */
export const MIN_INTERIOR_MM = 2 * CLEAT.wide;

const DENSITY_KG_M3 = { plywood: 600, lumber: 480 };
/** Placeholder material rates for a rough cost comparison between designs. */
const COST_PER_M3_USD = { plywood: 1100, lumber: 650 };

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
  id: "door" | "oversize" | "blocking" | "stack" | "stable" | "base-rating" | "utilization" | "export";
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
  materialCostUsd: number;
  /** Every rule, passed or not, in a fixed order. */
  checks: Check[];
}

/** Choose board sizes from payload mass. Simple, documented thresholds. */
export function resolveConstruction(settings: CrateSettings, payloadKg: number): Omit<Construction, "skidCount"> {
  const panelMm =
    settings.panelThickness !== "auto"
      ? settings.panelThickness
      : payloadKg <= 150
        ? 12
        : payloadKg <= 500
          ? 15
          : 19;
  const skid = payloadKg <= 700 ? { wide: 89, tall: 89 } : { wide: 89, tall: 140 };
  return { panelMm, floorMm: FLOOR_THICKNESS, skid };
}

/** What the structure adds to the interior on each axis — fed to the packer. */
export function structureAllowance(c: Omit<Construction, "skidCount">): Vec3 {
  const wall = 2 * (c.panelMm + CLEAT.thick);
  return [wall, wall, c.skid.tall + c.floorMm + c.panelMm + CLEAT.thick];
}

export function designCrate(part: DesignPart, settings: CrateSettings, layout: Layout): CrateDesign {
  const payloadKg = part.mass_kg * settings.quantity;
  const base = resolveConstruction(settings, payloadKg);
  const t = base.panelMm;
  const ct = CLEAT.thick;
  const cw = CLEAT.wide;
  const [L, W, H] = layout.interior;
  const extW = W + 2 * (t + ct);
  const skidCount = Math.max(2, Math.ceil(extW / 800) + 1);
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

  addDunnage(layout, settings, t, add);

  const bom = buildBom(members);
  const volumes = { plywood: 0, lumber: 0 };
  const tareKgByAssembly: Record<Assembly, number> = { base: 0, sides: 0, ends: 0, lid: 0, inside: 0 };
  let plywoodM2 = 0;
  let lumberM = 0;
  for (const m of members) {
    const volumeM3 = (m.size[0] * m.size[1] * m.size[2]) / 1e9;
    volumes[m.material] += volumeM3;
    tareKgByAssembly[m.assembly] += volumeM3 * DENSITY_KG_M3[m.material];
    const sorted = [...m.size].sort((p, q) => q - p);
    if (m.material === "plywood") plywoodM2 += (sorted[0] * sorted[1]) / 1e6;
    else lumberM += sorted[0] / 1000;
  }
  const tareKg = volumes.plywood * DENSITY_KG_M3.plywood + volumes.lumber * DENSITY_KG_M3.lumber;
  const materialCostUsd = volumes.plywood * COST_PER_M3_USD.plywood + volumes.lumber * COST_PER_M3_USD.lumber;

  const design: CrateDesign = {
    layout,
    construction,
    members,
    bom,
    payloadKg,
    tareKg,
    tareKgByAssembly,
    grossKg: payloadKg + tareKg,
    plywoodM2,
    lumberM,
    screws: estimateScrews(members, layout.interior),
    materialCostUsd,
    checks: [],
  };
  design.checks = evaluateChecks(design, part, settings);
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
  add: AddMember,
) {
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
        const by = Math.min(W - BLOCK_WIDTH, Math.max(0, y + b * fy - BLOCK_WIDTH / 2));
        block([x, by, 0], [a, BLOCK_WIDTH, clearZ], "bearer");
      }
    }

    // Gap on each side: to the wall (clearance) or to the neighbour (part gap).
    const [i, j] = slot.index;
    const [nx, ny] = layout.counts;
    const gx0 = i === 0 ? clearX : gap;
    const gx1 = i === nx - 1 ? clearX : gap;
    const gy0 = j === 0 ? clearY : gap;
    const gy1 = j === ny - 1 ? clearY : gap;
    const bwx = Math.min(BLOCK_WIDTH, a);
    const bwy = Math.min(BLOCK_WIDTH, b);
    const cx = x + a / 2 - bwx / 2;
    const cy = y + b / 2 - bwy / 2;
    if (gx0 >= MIN_BLOCKING_GAP) block([x - gx0, cy, floorZ], [gx0, bwy, h]);
    if (gx1 >= MIN_BLOCKING_GAP) block([x + a, cy, floorZ], [gx1, bwy, h]);
    if (gy0 >= MIN_BLOCKING_GAP) block([cx, y - gy0, floorZ], [bwx, gy0, h]);
    if (gy1 >= MIN_BLOCKING_GAP) block([cx, y + b, floorZ], [bwx, gy1, h]);
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

function verticalCount(span: number): number {
  return Math.max(2, Math.ceil(span / MAX_CLEAT_SPACING) + 1);
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

/** Wood screws: cleats every 150 mm, panel joints every 200 mm, 2 per block, skids every 300 mm. */
function estimateScrews(members: Member[], interior: Vec3): number {
  const [L, W, H] = interior;
  let screws = 0;
  for (const m of members) {
    const length = Math.max(...m.size);
    if (m.kind === "cleat" || m.kind === "lid-cleat") screws += Math.ceil(length / 150) + 1;
    else if (m.kind === "skid") screws += Math.ceil(length / 300) + 1;
    else if (m.kind === "blocking" || m.kind === "bearer") screws += 2;
  }
  const perimeter = 2 * (L + W);
  screws += Math.ceil(perimeter / 200) * 2; // walls to floor, lid to walls
  screws += Math.ceil(H / 200) * 4; // four vertical corners
  return screws;
}

const DOOR_CLEARANCE_MM = 2440; // 8 ft trailer / container door
const OVERSIZE_LENGTH_MM = 3000;
const STACK_LIMIT_KG = 100;
const BASE_RATING_KG = 1000;
const LOW_UTILIZATION = 0.25;

/** Every rule of thumb, reported whether it passes or not. Order is fixed; the UI sorts. */
function evaluateChecks(d: CrateDesign, part: DesignPart, settings: CrateSettings): Check[] {
  const checks: Check[] = [];
  const [eL, eW, eH] = d.layout.external;
  const nz = d.layout.counts[2];

  checks.push(
    eW > DOOR_CLEARANCE_MM || eH > DOOR_CLEARANCE_MM
      ? { id: "door", level: "caution", title: "Too big for a standard trailer door", detail: `Width or height is over ${DOOR_CLEARANCE_MM} mm. Confirm door clearance with the carrier.` }
      : { id: "door", level: "ok", title: "Fits a standard trailer door", detail: `Width and height are under ${DOOR_CLEARANCE_MM} mm.` },
  );

  const ratio = eH / Math.min(eL, eW);
  checks.push(
    d.layout.stable
      ? { id: "stable", level: "ok", title: "Stable footprint", detail: `Height is ${ratio.toFixed(2)}× the short side. The limit is ${STABLE_HEIGHT_RATIO}×.` }
      : { id: "stable", level: "caution", title: "Tip-over risk", detail: `Height is ${ratio.toFixed(2)}× the short side, over the ${STABLE_HEIGHT_RATIO}× limit. Strap it down or pick a lower layout.` },
  );

  const posts = d.members.filter((m) => m.kind === "blocking").length;
  checks.push(
    Math.min(settings.partGapMm, settings.wallClearanceMm) < MIN_BLOCKING_GAP
      ? { id: "blocking", level: "caution", title: "Parts are not restrained", detail: `Gaps under ${MIN_BLOCKING_GAP} mm leave no room for blocking. Widen the gap or the wall clearance.` }
      : { id: "blocking", level: "ok", title: "Every part is blocked in", detail: `${posts} blocking posts hold the parts on all four sides.` },
  );

  if (nz > 1) {
    const stackedKg = part.mass_kg * (nz - 1);
    checks.push(
      stackedKg > STACK_LIMIT_KG
        ? { id: "stack", level: "caution", title: "Heavy stack on the bottom layer", detail: `Each bottom position carries ${Math.round(stackedKg)} kg from above. Consider fewer layers.` }
        : { id: "stack", level: "ok", title: "Stack load is light", detail: `Each bottom position carries ${Math.round(stackedKg)} kg from above. The limit is ${STACK_LIMIT_KG} kg.` },
    );
  }

  const skidName = d.construction.skid.tall === 89 ? "4×4" : "4×6";
  checks.push(
    d.grossKg > BASE_RATING_KG
      ? { id: "base-rating", level: "caution", title: "Over 1,000 kg gross", detail: "Needs heavier skids and floor joists than this design includes." }
      : { id: "base-rating", level: "ok", title: "Within the standard base rating", detail: `Gross weight is under 1,000 kg, so ${skidName} skids and a ${d.construction.floorMm} mm floor are enough.` },
  );

  if (eL > OVERSIZE_LENGTH_MM) {
    checks.push({ id: "oversize", level: "info", title: "Oversize freight", detail: `Length is over ${OVERSIZE_LENGTH_MM} mm. Expect an oversize surcharge.` });
  }
  if (d.layout.utilization < LOW_UTILIZATION) {
    checks.push({ id: "utilization", level: "info", title: "Mostly empty space", detail: "Parts are packed by their bounding box, so irregular shapes leave air. A nested layout could be smaller." });
  }
  checks.push({ id: "export", level: "info", title: "Export shipments", detail: "Use ISPM-15 heat-treated, stamped lumber." });
  return checks;
}

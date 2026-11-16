import type { Layout } from "./packing";
import type { CrateSettings, Part, Vec3 } from "./schema";

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

export interface Member {
  kind: MemberKind;
  material: WoodMaterial;
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
  material: WoodMaterial;
  kind: MemberKind;
  /** e.g. "19 × 89" lumber section or "12 mm" plywood. */
  stock: string;
  /** Cut size: length for lumber, L × W for plywood. */
  cut: string;
  qty: number;
}

export interface Warning {
  level: "info" | "caution";
  message: string;
}

export interface CrateDesign {
  layout: Layout;
  construction: Construction;
  members: Member[];
  bom: BomLine[];
  payloadKg: number;
  tareKg: number;
  grossKg: number;
  plywoodM2: number;
  lumberM: number;
  screws: number;
  materialCostUsd: number;
  warnings: Warning[];
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

export function designCrate(part: Part, settings: CrateSettings, layout: Layout): CrateDesign {
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
  const add = (kind: MemberKind, material: WoodMaterial, min: Vec3, size: Vec3) => {
    if (size.every((s) => s > 0.5)) members.push({ kind, material, min, size });
  };

  // Base: floor sheet over the full footprint, skids underneath.
  const x0 = -t - ct;
  const y0 = -t - ct;
  const extL = L + 2 * (t + ct);
  add("floor", "plywood", [x0, y0, -base.floorMm], [extL, extW, base.floorMm]);
  const skidZ = -base.floorMm - base.skid.tall;
  spread(y0, extW, base.skid.wide, skidCount).forEach((y) =>
    add("skid", "lumber", [x0, y, skidZ], [extL, base.skid.wide, base.skid.tall]),
  );

  // Long side walls (−Y and +Y). Panels run the full outside length of the end walls.
  for (const side of [-1, 1] as const) {
    const panelY = side < 0 ? -t : W;
    const cleatY = side < 0 ? -t - ct : W + t;
    add("side", "plywood", [-t, panelY, 0], [L + 2 * t, t, H]);
    // Perimeter frame + intermediate verticals.
    add("cleat", "lumber", [-t, cleatY, 0], [L + 2 * t, ct, cw]);
    add("cleat", "lumber", [-t, cleatY, H - cw], [L + 2 * t, ct, cw]);
    spread(-t, L + 2 * t, cw, verticalCount(L + 2 * t)).forEach((x) =>
      add("cleat", "lumber", [x, cleatY, cw], [cw, ct, H - 2 * cw]),
    );
  }

  // End walls (−X and +X). Their cleats wrap the corners over the side cleats.
  for (const side of [-1, 1] as const) {
    const panelX = side < 0 ? -t : L;
    const cleatX = side < 0 ? -t - ct : L + t;
    add("end", "plywood", [panelX, 0, 0], [t, W, H]);
    add("cleat", "lumber", [cleatX, y0, 0], [ct, extW, cw]);
    add("cleat", "lumber", [cleatX, y0, H - cw], [ct, extW, cw]);
    spread(y0, extW, cw, verticalCount(extW)).forEach((y) =>
      add("cleat", "lumber", [cleatX, y, cw], [ct, cw, H - 2 * cw]),
    );
  }

  // Lid: panel plus a cleat frame on top, screwed down (removable for unpacking).
  add("lid", "plywood", [-t, -t, H], [L + 2 * t, W + 2 * t, t]);
  add("lid-cleat", "lumber", [-t, -t, H + t], [L + 2 * t, cw, ct]);
  add("lid-cleat", "lumber", [-t, W + t - cw, H + t], [L + 2 * t, cw, ct]);
  spread(-t, L + 2 * t, cw, verticalCount(L + 2 * t)).forEach((x) =>
    add("lid-cleat", "lumber", [x, -t + cw, H + t], [cw, W + 2 * t - 2 * cw, ct]),
  );

  addDunnage(layout, settings, t, add);

  const bom = buildBom(members);
  const volumes = { plywood: 0, lumber: 0 };
  let plywoodM2 = 0;
  let lumberM = 0;
  for (const m of members) {
    volumes[m.material] += (m.size[0] * m.size[1] * m.size[2]) / 1e9;
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
    grossKg: payloadKg + tareKg,
    plywoodM2,
    lumberM,
    screws: estimateScrews(members, layout.interior),
    materialCostUsd,
    warnings: [],
  };
  design.warnings = evaluateWarnings(design, part, settings);
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
  add: (kind: MemberKind, material: WoodMaterial, min: Vec3, size: Vec3) => void,
) {
  const [L, W] = layout.interior;
  const [a, b, c] = layout.cellSize;
  const [, , nz] = layout.counts;
  const gap = settings.partGapMm;
  const clear = settings.wallClearanceMm;
  const layerBase = (k: number) => clear + k * (c + gap + separatorMm);

  for (let k = 1; k < nz; k++) {
    add("separator", "plywood", [0, 0, layerBase(k) - separatorMm], [L, W, separatorMm]);
  }

  const placed = new Set<string>();
  const block = (min: Vec3, size: Vec3, kind: MemberKind = "blocking") => {
    const key = [...min, ...size].map((v) => Math.round(v)).join(",");
    if (placed.has(key)) return;
    placed.add(key);
    add(kind, "lumber", min, size);
  };

  for (const slot of layout.slots) {
    const [x, y, z] = slot.min;
    const k = slot.index[2];
    const floorZ = k === 0 ? 0 : layerBase(k);
    const topZ = k < nz - 1 ? layerBase(k + 1) - separatorMm : z + c;
    const h = topZ - floorZ;

    if (k === 0 && clear > 0) {
      for (const fy of [0.2, 0.8]) {
        block([x, y + b * fy - BLOCK_WIDTH / 2, 0], [a, BLOCK_WIDTH, clear], "bearer");
      }
    }

    // Gap on each side: to the wall (clearance) or to the neighbour (part gap).
    const [i, j] = slot.index;
    const [nx, ny] = layout.counts;
    const gx0 = i === 0 ? clear : gap;
    const gx1 = i === nx - 1 ? clear : gap;
    const gy0 = j === 0 ? clear : gap;
    const gy1 = j === ny - 1 ? clear : gap;
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

/** `count` evenly spaced start positions for boards of `width` across [start, start + span]. */
function spread(start: number, span: number, width: number, count: number): number[] {
  if (count <= 1) return [start];
  const step = (span - width) / (count - 1);
  return Array.from({ length: count }, (_, i) => start + i * step);
}

function verticalCount(span: number): number {
  return Math.max(2, Math.ceil(span / MAX_CLEAT_SPACING) + 1);
}

function buildBom(members: Member[]): BomLine[] {
  const lines = new Map<string, BomLine>();
  for (const m of members) {
    const s = [...m.size].map((v) => Math.round(v)).sort((p, q) => q - p);
    const stock = m.material === "plywood" ? `${s[2]} mm` : `${s[2]} × ${s[1]}`;
    const cut = m.material === "plywood" ? `${s[0]} × ${s[1]}` : `${s[0]}`;
    const key = `${m.kind}|${stock}|${cut}`;
    const line = lines.get(key);
    if (line) line.qty++;
    else lines.set(key, { material: m.material, kind: m.kind, stock, cut, qty: 1 });
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

function evaluateWarnings(d: CrateDesign, part: Part, settings: CrateSettings): Warning[] {
  const w: Warning[] = [];
  const [eL, eW, eH] = d.layout.external;
  if (eW > 2440 || eH > 2440) {
    w.push({ level: "caution", message: "Crate exceeds 2.44 m (8 ft) in width or height — check trailer/container door clearance." });
  }
  if (eL > 3000) w.push({ level: "info", message: "Crate longer than 3 m — may ship as oversize freight." });
  if (Math.min(settings.partGapMm, settings.wallClearanceMm) < MIN_BLOCKING_GAP) {
    w.push({
      level: "caution",
      message: `Gaps under ${MIN_BLOCKING_GAP} mm are too tight for wood blocking — parts there are unrestrained.`,
    });
  }
  const stackedKg = part.mass_kg * Math.max(0, d.layout.counts[2] - 1);
  if (stackedKg > 100) {
    w.push({ level: "caution", message: `${stackedKg.toFixed(0)} kg of parts stacked above each bottom-layer position — confirm the blocking posts and separators can carry it.` });
  }
  if (!d.layout.stable) w.push({ level: "caution", message: "Crate is much taller than it is wide — tip-over risk in handling." });
  if (d.grossKg > 1000) w.push({ level: "caution", message: "Gross weight over 1,000 kg — consider heavier skids and floor joists." });
  if (d.layout.utilization < 0.25) {
    w.push({ level: "info", message: "Low space utilization — bounding-box packing can't nest irregular shapes; consider smaller clearances or a different quantity." });
  }
  w.push({ level: "info", message: "For export, use ISPM-15 heat-treated, stamped lumber." });
  return w;
}

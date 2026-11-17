import { insideTag, placementKey } from "./dunnage";
import { sortDesc, type AddMember, type Member, type MemberVariant, type Notch } from "./members";
import type { Layout, Slot } from "./packing";
import type { CrateSettings, Vec3 } from "./schema";
import type { ShopStandards } from "./standards";

/**
 * Cradles for long, slender parts (#6, spec §7.5a).
 *
 * A shaft resting on two bearers and blocked with side posts can roll and bow. Real shaft
 * crates sit the part in **notched wooden saddles** across its length instead. This module
 * owns that path: when the part is slender (`isSlender`) and lies with its long axis
 * horizontal, `designCrate` calls `addCradleDunnage` in place of the general blocking.
 *
 * Ownership: slender parts are #6's, every other part is the general blocking's (#16). Both
 * use `isSlender` so exactly one path handles any part.
 */

export type { CradleProfile, Notch, NotchShape } from "./members";

/**
 * True when a part is long and slender: its longest side ÷ its middle side is at least
 * `cradle.slenderRatio` (3 by default). PART-002 (1530 × 172 × 172, ratio 8.9) is; PART-001
 * (1.4) and PART-003 (1.02) are not. The rule reads the part's own dimensions, so it doesn't
 * depend on the layout: the general blocking (#16) skips exactly these parts.
 */
export function isSlender(dims: Readonly<Vec3>, standards: Pick<ShopStandards, "cradle">): boolean {
  const [longest, middle] = sortDesc(dims);
  return middle > 0 && longest / middle >= standards.cradle.slenderRatio;
}

/**
 * True when this layout gets cradles: the part is slender and lies with its long axis
 * horizontal (along X or Y). A slender part stood on end (a layout the user picked) has no
 * length to cradle, so it keeps the general blocking.
 */
export function usesCradles(dims: Readonly<Vec3>, layout: Pick<Layout, "cellSize">, standards: Pick<ShopStandards, "cradle">): boolean {
  if (!isSlender(dims, standards)) return false;
  const [a, b, c] = layout.cellSize;
  return Math.max(a, b) >= c;
}

/** The axis the part's length lies along in the layout (0 = X, 1 = Y). */
export function longAxis(cellSize: Readonly<Vec3>): 0 | 1 {
  return cellSize[0] >= cellSize[1] ? 0 : 1;
}

/**
 * Cradle centre lines along a part of length `length` starting at `start`: one
 * `cradle.endOffsetMm` (150) in from each end, and evenly spaced between them at most
 * `cradle.maxSpacingMm` (600) apart, so at least 2. On a short part the end offset is cut to
 * a quarter of the length so the two end cradles don't meet.
 */
export function cradleStations(start: number, length: number, standards: Pick<ShopStandards, "cradle">): number[] {
  const { endOffsetMm, maxSpacingMm } = standards.cradle;
  const end = Math.min(endOffsetMm, length / 4);
  const run = length - 2 * end;
  const count = Math.max(2, Math.ceil(run / maxSpacingMm - 1e-9) + 1);
  return Array.from({ length: count }, (_, i) => start + end + (i * run) / (count - 1));
}

/**
 * The notch for a part whose cross-section is `width` across the cradle and `height` tall.
 * Depth is `cradle.notchDepth` × the height (25%). A near-square section (sides within
 * `cradle.roundTolerance`, 10%) is taken as round and gets a circular seat of the part's
 * radius, whose opening is the chord at that depth; any other section gets a flat pocket as
 * wide as the part.
 */
export function notchFor(width: number, height: number, standards: Pick<ShopStandards, "cradle">): Pick<Notch, "width" | "depth" | "shape" | "radius"> {
  const depth = standards.cradle.notchDepth * height;
  const round = Math.abs(width - height) <= standards.cradle.roundTolerance * Math.max(width, height);
  if (!round) return { width, depth, shape: "flat", radius: 0 };
  const r = Math.max(width, height) / 2;
  return { width: 2 * Math.sqrt(Math.max(0, depth * (2 * r - depth))), depth, shape: "round", radius: r };
}

/** Screws per cradle: two at each end, into the floor (cradle) or through the side wall (stacking cradle). */
export const SCREWS_PER_CRADLE = 4;

export const CRADLE_LABEL = "Cradle";
export const STACKING_CRADLE_LABEL = "Stacking cradle";
export const END_STOP_LABEL = "End stop";

/**
 * Dunnage for a slender part lying flat, in place of bearers, separators and side blocking:
 *
 * - **Cradles** on the floor at each station (`cradleStations`), spanning wall to wall across
 *   the part, `cradle.thickMm` (38) thick along it. Top at the part's bottom + notch depth;
 *   one notch per part in the row. They replace the bearers and the side posts.
 * - **Stacking cradles** between layers, at the same stations: notched underneath over the
 *   layer below and on top for the layer above, filling the part gap and the separator's
 *   place, so the layers' cradles stack into one column. No separator sheet.
 * - **End stops** at both ends of every part, in the gap to the end wall or the next part,
 *   from the floor to the top of the column of parts, so the part can't slide along its axis.
 *   Same width rule and minimum gap as blocking posts.
 */
export function addCradleDunnage(layout: Layout, settings: CrateSettings, standards: ShopStandards, add: AddMember): void {
  const u = longAxis(layout.cellSize);
  const v: 0 | 1 = u === 0 ? 1 : 0;
  const c = layout.cellSize[2];
  const len = layout.cellSize[u];
  const wid = layout.cellSize[v];
  const span = layout.interior[v];
  const thick = standards.cradle.thickMm;
  const shape = notchFor(wid, c, standards);
  const d = shape.depth;

  // Layer bottoms, from the slots (the packer's positions; nothing moves).
  const nz = layout.counts[2];
  const layerZ = Array.from({ length: nz }, (_, k) => layout.slots.find((s) => s.index[2] === k)?.min[2] ?? 0);
  // Rows along the long axis: every slot with the same index on `u` shares stations.
  const rows = new Map<number, Slot[]>();
  for (const s of layout.slots) rows.set(s.index[u], [...(rows.get(s.index[u]) ?? []), s]);

  const notchesFor = (slots: Slot[], face: Notch["face"]): Notch[] =>
    slots.map((s) => ({ ...shape, center: s.min[v] + wid / 2, face })).sort((p, q) => p.center - q.center);
  const board = (at: number, z0: number, z1: number, label: string, notches: Notch[], variant?: MemberVariant) => {
    const min: Vec3 = [0, 0, z0];
    const size: Vec3 = [0, 0, z1 - z0];
    min[u] = at - thick / 2;
    size[u] = thick;
    min[v] = 0;
    size[v] = span;
    add("cradle", "lumber", insideTag(label, variant), min, size, { axis: v, notches });
  };

  for (const [, slots] of [...rows].sort((p, q) => p[0] - q[0])) {
    const start = slots[0].min[u];
    const inLayer = (k: number) => slots.filter((s) => s.index[2] === k);
    for (const at of cradleStations(start, len, standards)) {
      board(at, 0, layerZ[0] + d, CRADLE_LABEL, notchesFor(inLayer(0), "top"));
      for (let k = 0; k + 1 < nz; k++) {
        const upper = inLayer(k + 1);
        if (!upper.length) continue;
        const notches = [...notchesFor(inLayer(k), "bottom"), ...notchesFor(upper, "top")];
        board(at, layerZ[k] + c - d, layerZ[k + 1] + d, STACKING_CRADLE_LABEL, notches, "stacking-cradle");
      }
    }
  }

  // End stops: one per end of each column of parts (same position on X and Y, every layer).
  const blockWidth = standards.stock.blockWidthMm;
  const minGap = standards.construction.minBlockingGapMm;
  const gap = settings.partGapMm;
  const clear = layout.clearance[u];
  const n = layout.counts[u];
  const placed = new Set<string>();
  const columns = new Map<string, Slot[]>();
  for (const s of layout.slots) {
    const key = `${s.index[0]},${s.index[1]}`;
    columns.set(key, [...(columns.get(key) ?? []), s]);
  }
  for (const column of columns.values()) {
    const s = column[0];
    const i = s.index[u];
    const top = Math.max(...column.map((p) => p.min[2])) + c;
    const bw = Math.min(blockWidth, wid);
    for (const end of [0, 1] as const) {
      const g = end === 0 ? (i === 0 ? clear : gap) : i === n - 1 ? clear : gap;
      if (g < minGap) continue;
      const min: Vec3 = [0, 0, 0];
      const size: Vec3 = [0, 0, top];
      min[u] = end === 0 ? s.min[u] - g : s.min[u] + len;
      size[u] = g;
      min[v] = s.min[v] + wid / 2 - bw / 2;
      size[v] = bw;
      const key = placementKey(min, size);
      if (placed.has(key)) continue;
      placed.add(key);
      add("blocking", "lumber", insideTag(END_STOP_LABEL), min, size);
    }
  }
}

/** Arc segments per round notch when drawn. */
const ARC_STEPS = 16;

/**
 * A cradle's outline in its own plane: (along the board's length axis, Z) points in crate
 * mm, counter-clockwise, round notches as polylines. The 3D view extrudes it through the
 * board's thickness; a member without notches is its rectangle.
 */
export function cradleProfile(m: Pick<Member, "min" | "size" | "cradle">): [number, number][] {
  const axis = m.cradle?.axis ?? 1;
  const a0 = m.min[axis];
  const a1 = a0 + m.size[axis];
  const z0 = m.min[2];
  const z1 = z0 + m.size[2];
  const notches = m.cradle?.notches ?? [];
  const cut = (face: Notch["face"], forward: boolean): [number, number][] => {
    const list = notches.filter((n) => n.face === face).sort((p, q) => (forward ? p.center - q.center : q.center - p.center));
    const edge = face === "top" ? z1 : z0;
    const sign = face === "top" ? -1 : 1; // into the board
    const pts: [number, number][] = [];
    for (const n of list) {
      const half = n.width / 2;
      const [from, to] = forward ? [n.center - half, n.center + half] : [n.center + half, n.center - half];
      if (n.shape === "flat") {
        pts.push([from, edge], [from, edge + sign * n.depth], [to, edge + sign * n.depth], [to, edge]);
        continue;
      }
      // Circle centre: the seat's bottom is `depth` in from the face, the centre a radius beyond it.
      const cz = edge + sign * n.depth - sign * n.radius;
      for (let i = 0; i <= ARC_STEPS; i++) {
        const x = from + ((to - from) * i) / ARC_STEPS;
        const dx = x - n.center;
        const dz = Math.sqrt(Math.max(0, n.radius * n.radius - dx * dx));
        pts.push([x, i === 0 || i === ARC_STEPS ? edge : cz + sign * dz]);
      }
    }
    return pts;
  };
  return [[a0, z0], ...cut("bottom", true), [a1, z0], [a1, z1], ...cut("top", false), [a0, z1]];
}

/**
 * The solid Z range of a cradle at `at` along its length axis (inside a notch it is shorter),
 * for the build sheet's sections. Members without notches return their full height.
 */
export function cradleSolidAt(m: Pick<Member, "min" | "size" | "cradle">, at: number): [number, number] {
  let lo = m.min[2];
  let hi = lo + m.size[2];
  const bottom = lo;
  const top = hi;
  for (const n of m.cradle?.notches ?? []) {
    const dx = Math.abs(at - n.center);
    if (dx >= n.width / 2) continue;
    const depth = n.shape === "flat" ? n.depth : n.depth - (n.radius - Math.sqrt(Math.max(0, n.radius * n.radius - dx * dx)));
    if (n.face === "top") hi = Math.min(hi, top - depth);
    else lo = Math.max(lo, bottom + depth);
  }
  return [lo, Math.max(lo, hi)];
}

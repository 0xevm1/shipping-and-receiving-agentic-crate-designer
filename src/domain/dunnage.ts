import type { AddMember, MemberVariant, Tag } from "./members";
import type { Layout } from "./packing";
import { planShapedBlocking, slotPlans, type BlockBox, type PartProfile } from "./profile";
import type { CrateSettings, Vec3 } from "./schema";
import type { ShopStandards } from "./standards";

/**
 * Internal wooden dunnage that holds the parts in place. This module adds the general kind
 * (bearers, separators, blocking posts, shaped blocks); slender parts get cradles instead
 * (`cradles.ts`). Both use the helpers exported here.
 */

/** Cut-list name of a block shaped to the part (spec §7.5b). */
export const SHAPED_BLOCK = "Shaped block";

/** Tag for a board inside the crate (the "inside" assembly and face). */
export function insideTag(label: string, variant?: MemberVariant): Tag {
  return { assembly: "inside", face: "inside", label, ...(variant && { variant }) };
}

/** A board's position and size to the nearest mm, to spot the same board added twice. */
export function placementKey(min: Vec3, size: Vec3): string {
  return [...min, ...size].map((v) => Math.round(v)).join(",");
}

/**
 * Bearers, separators and blocking:
 * - bearers lift the bottom layer off the floor by the wall clearance,
 * - plywood separators between layers,
 * - blocking posts in every gap around each part, running floor-to-separator
 *   so they also carry the layer above,
 * - with a part `profile`, posts sit where the part is solid and shaped blocks reach into
 *   its recesses (spec §7.5b).
 * Returns the blocking pieces and the axis each one blocks along, for measuring restraint.
 */
export function addDunnage(
  layout: Layout,
  settings: CrateSettings,
  separatorMm: number,
  standards: ShopStandards,
  add: AddMember,
  profile: PartProfile | null,
): BlockBox[] {
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
  const pieces: BlockBox[] = [];
  const block = (min: Vec3, size: Vec3, kind: "blocking" | "bearer" = "blocking", axis: 0 | 1 = 0, shapedBlock = false) => {
    const key = placementKey(min, size);
    if (placed.has(key)) return;
    placed.add(key);
    const tag = kind === "bearer" ? insideTag("Bearer") : shapedBlock ? insideTag(SHAPED_BLOCK, "shaped-block") : insideTag("Blocking post");
    add(kind, "lumber", tag, min, size);
    if (kind === "blocking" && size.every((s) => s > 0.5)) pieces.push({ min, size, axis });
  };
  const shaped = profile ? planShapedBlocking(profile, layout, blockWidth) : null;

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
    // Shaped: each post where its plan puts it, plus shaped blocks against this part's faces.
    const plans = shaped && slotPlans(shaped, slot.index, layout.counts);
    const cx0 = plans ? x + plans.y.low.offset : x + a / 2 - bwx / 2;
    const cx1 = plans ? x + plans.y.high.offset : cx0;
    const cy0 = plans ? y + plans.x.low.offset : y + b / 2 - bwy / 2;
    const cy1 = plans ? y + plans.x.high.offset : cy0;
    const shape = (min: Vec3, size: Vec3, axis: 0 | 1) => block(min, size, "blocking", axis, true);
    if (gx0 >= minBlockingGap) {
      block([x - gx0, cy0, floorZ], [gx0, bwy, h]);
      plans?.x.low.fillHigh.forEach((f) => shape([x, cy0, z + f.z0], [f.depth, bwy, f.z1 - f.z0], 0));
    }
    if (gx1 >= minBlockingGap) {
      block([x + a, cy1, floorZ], [gx1, bwy, h]);
      plans?.x.high.fillLow.forEach((f) => shape([x + a - f.depth, cy1, z + f.z0], [f.depth, bwy, f.z1 - f.z0], 0));
    }
    if (gy0 >= minBlockingGap) {
      block([cx0, y - gy0, floorZ], [bwx, gy0, h], "blocking", 1);
      plans?.y.low.fillHigh.forEach((f) => shape([cx0, y, z + f.z0], [bwx, f.depth, f.z1 - f.z0], 1));
    }
    if (gy1 >= minBlockingGap) {
      block([cx1, y + b, floorZ], [bwx, gy1, h], "blocking", 1);
      plans?.y.high.fillLow.forEach((f) => shape([cx1, y + b - f.depth, z + f.z0], [bwx, f.depth, f.z1 - f.z0], 1));
    }
  }
  return pieces;
}

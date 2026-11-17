import type { Construction } from "./construction";
import type { Layout } from "./packing";
import type { AddMember, Tag } from "./members";
import { DEFAULT_STANDARDS, type ShopStandards } from "./standards";
import { frameCount } from "./structure";

/**
 * The crate's shell as boards: floor, joists and skids; the four walls; the lid. Everything
 * the carpenter builds before the dunnage goes in. Sizes come from the `Construction` the
 * structural sizing settled on; this module only lays them out.
 */

/** `count` evenly spaced start positions for boards of `width` across [start, start + span]. */
function spread(start: number, span: number, width: number, count: number): number[] {
  if (count <= 1) return [start];
  const step = (span - width) / (count - 1);
  return Array.from({ length: count }, (_, i) => start + i * step);
}

/** Adds the base, walls and lid of a crate with this interior and construction. */
export function addShell(interior: Layout["interior"], c: Construction, add: AddMember, standards: ShopStandards = DEFAULT_STANDARDS): void {
  const { panelMm: t, floorMm, cleat, skid, skidCount, joist, baseMm } = c;
  const { thick: ct, wide: cw } = cleat;
  const [L, W, H] = interior;
  const extL = L + 2 * (t + ct);
  const extW = W + 2 * (t + ct);
  const x0 = -t - ct;
  const y0 = -t - ct;
  const verticalCount = (span: number) => frameCount(span, standards);

  // Base: floor sheet over the full footprint, floor joists across the skids, skids underneath.
  const baseTag = (label: string): Tag => ({ assembly: "base", face: "base", label });
  add("floor", "plywood", baseTag("Floor"), [x0, y0, -floorMm], [extL, extW, floorMm]);
  if (joist) {
    spread(x0, extL, joist.wide, joist.count).forEach((x) =>
      add("joist", "lumber", baseTag("Floor joist"), [x, y0, -floorMm - joist.tall], [joist.wide, extW, joist.tall]),
    );
  }
  spread(y0, extW, skid.wide, skidCount).forEach((y) => add("skid", "lumber", baseTag("Skid"), [x0, y, -baseMm], [extL, skid.wide, skid.tall]));

  // Long side walls (−Y and +Y). Panels run the full outside length of the end walls.
  for (const side of [-1, 1] as const) {
    const panelY = side < 0 ? -t : W;
    const cleatY = side < 0 ? -t - ct : W + t;
    const tag = (label: string): Tag => ({ assembly: "sides", face: side < 0 ? "side-" : "side+", label });
    add("side", "plywood", tag("Side panel"), [-t, panelY, 0], [L + 2 * t, t, H]);
    // Perimeter frame + intermediate verticals.
    add("cleat", "lumber", tag("Side rail"), [-t, cleatY, 0], [L + 2 * t, ct, cw]);
    add("cleat", "lumber", tag("Side rail"), [-t, cleatY, H - cw], [L + 2 * t, ct, cw]);
    spread(-t, L + 2 * t, cw, verticalCount(L + 2 * t)).forEach((x) => add("cleat", "lumber", tag("Side upright"), [x, cleatY, cw], [cw, ct, H - 2 * cw]));
  }

  // End walls (−X and +X). Their cleats wrap the corners over the side cleats.
  for (const side of [-1, 1] as const) {
    const panelX = side < 0 ? -t : L;
    const cleatX = side < 0 ? -t - ct : L + t;
    const tag = (label: string): Tag => ({ assembly: "ends", face: side < 0 ? "end-" : "end+", label });
    add("end", "plywood", tag("End panel"), [panelX, 0, 0], [t, W, H]);
    add("cleat", "lumber", tag("End rail"), [cleatX, y0, 0], [ct, extW, cw]);
    add("cleat", "lumber", tag("End rail"), [cleatX, y0, H - cw], [ct, extW, cw]);
    spread(y0, extW, cw, verticalCount(extW)).forEach((y) => add("cleat", "lumber", tag("End upright"), [cleatX, y, cw], [ct, cw, H - 2 * cw]));
  }

  // Lid: panel plus a cleat frame on top, screwed down (removable for unpacking). When crates
  // may be stacked the frame is sized for the load, possibly as joists on edge.
  const lidTag = (label: string): Tag => ({ assembly: "lid", face: "lid", label });
  const { wide: lw, tall: lt, count: lidCount, joists: lidJoists } = c.lid;
  const [edgeLabel, crossLabel] = lidJoists ? ["Lid edge joist", "Lid joist"] : ["Lid edge cleat", "Lid cross cleat"];
  add("lid", "plywood", lidTag("Lid panel"), [-t, -t, H], [L + 2 * t, W + 2 * t, t]);
  add("lid-cleat", "lumber", lidTag(edgeLabel), [-t, -t, H + t], [L + 2 * t, lw, lt]);
  add("lid-cleat", "lumber", lidTag(edgeLabel), [-t, W + t - lw, H + t], [L + 2 * t, lw, lt]);
  spread(-t, L + 2 * t, lw, lidCount).forEach((x) => add("lid-cleat", "lumber", lidTag(crossLabel), [x, -t + lw, H + t], [lw, W + 2 * t - 2 * lw, lt]));
}

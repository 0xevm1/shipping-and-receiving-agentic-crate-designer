import type { ShopStandards } from "./standards";

/**
 * Where a forklift or pallet jack may enter the crate (#112), a shop standard
 * (`handling.forkEntry`). It decides how the base is built:
 *
 * - `ends`: the skids run along the length (X); forks enter between them from the two ends. The
 *   original and default build.
 * - `sides`: the skids run across the width (Y), spaced along the length; forks enter between
 *   them from the two long sides.
 * - `fourWay`: the skids run along X as for `ends`, and a lifting block under each end of every
 *   skid lifts them off the ground, so forks also enter under the skids from the sides. Blocks
 *   rather than notches: the clear height a fork needs (85 mm for the shipped pallet jack) is
 *   about the whole 89 mm skid, so a notch would cut it through; blocks are plain cut-offs of
 *   stock, screwed on, and leave the skid's section whole.
 */
export const FORK_ENTRIES = ["ends", "sides", "fourWay"] as const;
export type ForkEntry = (typeof FORK_ENTRIES)[number];

/** A direction the forks travel: `ends` along the length (X), `sides` along the width (Y). */
export type ForkDirection = "ends" | "sides";

/** The directions a crate must be enterable from, per entry. */
export function entryDirections(entry: ForkEntry): ForkDirection[] {
  return entry === "ends" ? ["ends"] : entry === "sides" ? ["sides"] : ["ends", "sides"];
}

/** True when the skids run across the width (Y) instead of along the length (X). */
export const skidsRunAcross = (entry: ForkEntry): boolean => entry === "sides";

/** Shipping-label wording. */
export const FORK_ENTRY_TEXT: Record<ForkEntry, string> = {
  ends: "Fork entry from the ends",
  sides: "Fork entry from the sides",
  fourWay: "Fork entry from all four sides",
};

/**
 * Height of a four-way crate's lifting blocks, mm: the clearance the taller-needing of the two
 * lifting devices asks for, so both fit under the skids from the sides.
 */
export function liftHeightMm(standards: ShopStandards): number {
  const { forklift, palletJack } = standards.handling;
  return Math.max(forklift.minClearMm, palletJack.minClearMm);
}

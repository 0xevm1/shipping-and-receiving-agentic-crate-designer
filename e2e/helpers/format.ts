import type { Vec3 } from "../../src/domain/schema";

/**
 * How the app writes a size, derived from the probe's millimetres. Specs read the expected numbers from
 * `window.__crate` and only check that the screen shows them in the right format; the numbers
 * themselves are pinned by the domain unit tests.
 */
export const mmText = (size: readonly number[]) => size.map((v) => Math.round(v)).join(" × ");

/** Inches to one decimal, as the Overview, header and size labels show them. */
export const inText = (size: readonly number[]) => size.map((v) => (v / 25.4).toFixed(1)).join(" × ");

/** The size as the unit-less rounded-millimetre tuple a design file's `summary.outsideMm` holds. */
export const roundedMm = (size: Vec3 | readonly number[]) => size.map((v) => Math.round(v));

/**
 * US nominal lumber names ("2x4") for the surfaced (S4S) sizes the shop standards use. The one
 * table the domain's check text and the cut list agree on; the plain `x` is the house style.
 */

/** Nominal name and actual size in mm, thinner side first. */
export const NOMINAL_LUMBER: readonly { name: string; mm: readonly [number, number] }[] = [
  { name: "1x2", mm: [19, 38] },
  { name: "1x3", mm: [19, 64] },
  { name: "1x4", mm: [19, 89] },
  { name: "1x6", mm: [19, 140] },
  { name: "1x8", mm: [19, 184] },
  { name: "1x10", mm: [19, 235] },
  { name: "1x12", mm: [19, 286] },
  { name: "2x2", mm: [38, 38] },
  { name: "2x3", mm: [38, 64] },
  { name: "2x4", mm: [38, 89] },
  { name: "2x6", mm: [38, 140] },
  { name: "2x8", mm: [38, 184] },
  { name: "2x10", mm: [38, 235] },
  { name: "2x12", mm: [38, 286] },
  { name: "4x4", mm: [89, 89] },
  { name: "4x6", mm: [89, 140] },
  { name: "4x8", mm: [89, 184] },
  { name: "6x6", mm: [140, 140] },
  { name: "6x8", mm: [140, 184] },
];

/** A millimetre either way: sizes are rounded to whole mm, and 1x4 is really 19.05 × 88.9. */
export const TOLERANCE_MM = 1;

/** "2x4" for a 38 × 89 section (either order), or null when it isn't stock. */
export function nominalLumber(a: number, b: number): string | null {
  const [t, w] = a <= b ? [a, b] : [b, a];
  const hit = NOMINAL_LUMBER.find((n) => Math.abs(n.mm[0] - t) <= TOLERANCE_MM && Math.abs(n.mm[1] - w) <= TOLERANCE_MM);
  return hit?.name ?? null;
}

/** File names for the cut-list and design downloads, so they read the same wherever they are made. */

interface CutListScope {
  partId: string;
  quantity: number;
  /** The batch is split across crate types. */
  split: boolean;
  /** The whole shipment, not the crate type on screen. */
  whole: boolean;
  /** The crate type on screen ("A"). */
  crateLabel: string;
}

/** "crate-PART-001-x4.csv"; a split batch adds the crate type, or "shipment" for all of them. */
export function cutListFileName({ partId, quantity, split, whole, crateLabel }: CutListScope): string {
  const base = `crate-${partId}-x${quantity}`;
  if (!split) return `${base}.csv`;
  return whole ? `${base}-shipment.csv` : `${base}-crate-${crateLabel}.csv`;
}

/** "crate-design-PART-001-x4.json": the design file for the batch on screen. */
export const designFileName = (partId: string, quantity: number): string => `crate-design-${partId}-x${quantity}.json`;

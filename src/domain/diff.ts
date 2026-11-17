import type { CrateDesign } from "./crate";

/**
 * What an edit changed in the crate. One place compares the previous and the new
 * design, so the header note and the Overview highlights agree on what moved.
 */

/** The design values the UI highlights when they change, in the order the note lists them. */
export const DESIGN_FIELDS = ["gross", "outside", "panel", "floor", "skid", "skidCount", "grid", "payload", "tare"] as const;
export type DesignField = (typeof DESIGN_FIELDS)[number];

/**
 * One changed value, in domain units: kg for `gross`, `payload` and `tare`; mm for `outside`
 * (L × W × H), `panel`, `floor` and `skid` (wide × tall); a count for `skidCount`; parts per
 * axis for `grid` (x × y × z).
 */
export interface DesignChange {
  field: DesignField;
  from: number | readonly number[];
  to: number | readonly number[];
}

/** Weights are compared to the gram, so floating-point noise never counts as a change. */
const KG_EPSILON = 0.0005;

function read(d: CrateDesign, f: DesignField): number | readonly number[] {
  switch (f) {
    case "gross":
      return d.grossKg;
    case "payload":
      return d.payloadKg;
    case "tare":
      return d.tareKg;
    case "outside":
      return d.layout.external;
    case "panel":
      return d.construction.panelMm;
    case "floor":
      return d.construction.floorMm;
    case "skid":
      return [d.construction.skid.wide, d.construction.skid.tall];
    case "skidCount":
      return d.construction.skidCount;
    case "grid":
      return d.layout.counts;
  }
}

const isWeight = (f: DesignField) => f === "gross" || f === "payload" || f === "tare";

function same(f: DesignField, a: number | readonly number[], b: number | readonly number[]): boolean {
  if (typeof a === "number" && typeof b === "number") return isWeight(f) ? Math.abs(a - b) < KG_EPSILON : a === b;
  if (typeof a === "number" || typeof b === "number") return false;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The fields that differ between two designs, with old and new values, in `DESIGN_FIELDS`
 * order. Pure. Returns `[]` when the designs match, and also when either is missing (a
 * `problem` replaced the design, so there is nothing to compare).
 */
export function diffDesigns(prev: CrateDesign | null, next: CrateDesign | null): DesignChange[] {
  if (!prev || !next) return [];
  const changes: DesignChange[] = [];
  for (const field of DESIGN_FIELDS) {
    const from = read(prev, field);
    const to = read(next, field);
    if (!same(field, from, to)) changes.push({ field, from, to });
  }
  return changes;
}

import type { BomLine } from "./bom";
import type { Check } from "./check";
import type { Construction } from "./construction";
import type { CrateCost, FreightTerms, LabourEstimate } from "./cost";
import type { Handling } from "./handling";
import type { Assembly, Member } from "./members";
import type { Layout } from "./packing";
import type { Restraint } from "./profile";
import type { SheetsNeeded } from "./sheets";
import type { SpliceReport } from "./shell";
import type { StructurePlan } from "./structure";

/** A designed crate: the boards, the cut list, weights, cost, handling and every check's result. */
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
  /** Plywood sheets to buy (spec §7.5c): by area plus a waste allowance, per thickness. */
  sheets: SheetsNeeded;
  /** Panels bigger than a sheet, spliced from pieces with a joint cleat behind each seam (spec §7.5c). */
  splices: SpliceReport;
  screws: number;
  /** Plywood and lumber only (`rates.costUsdPerM3`); `cost` adds screws and labour. */
  materialCostUsd: number;
  /** Build time and labour cost (spec §7.12). */
  labour: LabourEstimate;
  /** Wood + screws + labour. */
  cost: CrateCost;
  /** Domestic LTL terms: gross lb, volume, dimensional weight, density and estimated class. */
  freight: FreightTerms;
  /** Structural sizing (spec §7.15): the base and lid plan, the dead load and the base rating. */
  structure: StructurePlan;
  /**
   * Centre of gravity (`cogMm`, spec §7.14: the crate and the parts, in the crate-interior frame
   * of `members`, origin at the interior min corner on top of the floor, Z up), tip angle and
   * fork openings (`handling.ts`).
   */
  handling: Handling;
  /** Every rule, passed or not, in a fixed order. */
  checks: Check[];
  /**
   * Set when blocking was shaped to a measured part profile (spec §7.5b): how well it holds
   * the parts, and how well bounding-box blocking would have, measured the same way.
   */
  shapedBlocking?: { shaped: Restraint; boundingBox: Restraint; blocks: number };
}

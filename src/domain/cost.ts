import type { BomLine } from "./crate";
import type { Vec3 } from "./schema";
import { DEFAULT_STANDARDS, type ShopStandards } from "./standards";
import { IN3_PER_FT3, LB_PER_KG, MM_PER_IN } from "./units";

/**
 * What a crate costs to build and what it looks like to a freight booker (#17, spec §7.12).
 *
 * - **Labour:** build time from the cut list and the screw count, at the shop's minutes per
 *   step (`standards.labour`), times the labour rate.
 * - **Cost:** wood + screws + labour.
 * - **Freight terms** for domestic LTL: gross weight, outside volume, dimensional weight,
 *   density and an estimated density-based NMFC class. No dollar rates: those depend on the
 *   lane, the carrier and the shipper's tariff.
 *
 * Pure: everything is computed from the design's cut list, screws and outside size.
 */

/** Assembly steps that don't depend on the layout: the base, four walls and the lid. */
export const FIXED_ASSEMBLY_STEPS = 6;

export interface LabourEstimate {
  /** What was counted. */
  counts: {
    lumberCuts: number;
    plywoodCuts: number;
    /** Distinct stock-and-cut sizes in the cut list: each is one saw set-up. */
    cutSizes: number;
    screws: number;
    /** Base, four walls, lid, and one dunnage step per layer. */
    steps: number;
  };
  /** Minutes per activity. */
  minutes: { cutting: number; setup: number; fastening: number; assembly: number; handling: number };
  totalMin: number;
  hours: number;
  /** `hours × labour.rateUsdPerHour`. */
  costUsd: number;
}

/** Build time and labour cost for one crate. */
export function estimateLabour(
  bom: readonly (Pick<BomLine, "material" | "stock" | "cut" | "qty"> & Partial<Pick<BomLine, "notches">>)[],
  screws: number,
  layers: number,
  standards: ShopStandards = DEFAULT_STANDARDS,
): LabourEstimate {
  const l = standards.labour;
  let lumberCuts = 0;
  let plywoodCuts = 0;
  const sizes = new Set<string>();
  for (const line of bom) {
    if (line.material === "plywood") plywoodCuts += line.qty;
    else lumberCuts += line.qty * (1 + (line.notches ?? 0)); // each cradle notch is one more cut (#6)
    sizes.add(`${line.material}|${line.stock}|${line.cut}`);
  }
  const steps = FIXED_ASSEMBLY_STEPS + layers;
  const minutes = {
    cutting: lumberCuts * l.lumberCutMin + plywoodCuts * l.plywoodCutMin,
    setup: sizes.size * l.setupMin,
    fastening: screws * l.screwMin,
    assembly: steps * l.assemblyStepMin,
    handling: l.handlingMin,
  };
  const totalMin = minutes.cutting + minutes.setup + minutes.fastening + minutes.assembly + minutes.handling;
  const hours = totalMin / 60;
  return {
    counts: { lumberCuts, plywoodCuts, cutSizes: sizes.size, screws, steps },
    minutes,
    totalMin,
    hours,
    costUsd: hours * l.rateUsdPerHour,
  };
}

export interface CrateCost {
  /** Plywood and lumber (`materialCostUsd`). */
  woodUsd: number;
  /** Screws at `rates.screwCostUsdPer100`. */
  fastenersUsd: number;
  /** Wood + fasteners. */
  materialUsd: number;
  labourUsd: number;
  /** Material + labour: what one crate costs to build. */
  totalUsd: number;
}

export function crateCost(woodUsd: number, screws: number, labourUsd: number, standards: ShopStandards = DEFAULT_STANDARDS): CrateCost {
  const fastenersUsd = (screws / 100) * standards.rates.screwCostUsdPer100;
  const materialUsd = woodUsd + fastenersUsd;
  return { woodUsd, fastenersUsd, materialUsd, labourUsd, totalUsd: materialUsd + labourUsd };
}

/**
 * The NMFC 13-sub density scale (NMFTA, NMFC Docket 2025-1, Item 100; density-based classes
 * in effect from 19 July 2025, adding classes 55 and 50 to the old 11-sub scale). Density in
 * lb/ft³ of the shipment's outside dimensions; each row applies from `minLbFt3` up to, but not
 * including, the row above. Transcribed from the published table as reproduced at
 * https://www.dtsone.com/breaking-down-the-july-2025-nmfc-changes/ (checked 2026-11). The NMFC
 * itself (ClassIT) is the authority: some commodities have their own class, and a carrier can
 * re-class on inspection, so the app calls this an estimate.
 */
export const NMFC_DENSITY_SCALE: readonly { minLbFt3: number; freightClass: number }[] = Object.freeze([
  { minLbFt3: 50, freightClass: 50 },
  { minLbFt3: 35, freightClass: 55 },
  { minLbFt3: 30, freightClass: 60 },
  { minLbFt3: 22.5, freightClass: 65 },
  { minLbFt3: 15, freightClass: 70 },
  { minLbFt3: 12, freightClass: 85 },
  { minLbFt3: 10, freightClass: 92.5 },
  { minLbFt3: 8, freightClass: 100 },
  { minLbFt3: 6, freightClass: 125 },
  { minLbFt3: 4, freightClass: 175 },
  { minLbFt3: 2, freightClass: 250 },
  { minLbFt3: 1, freightClass: 300 },
  { minLbFt3: 0, freightClass: 400 },
]);

/** Estimated NMFC class for a density in lb/ft³. Anything that isn't a positive number is class 400. */
export function freightClassFor(densityLbFt3: number): number {
  if (!Number.isFinite(densityLbFt3) || densityLbFt3 <= 0) return 400;
  return NMFC_DENSITY_SCALE.find((r) => densityLbFt3 >= r.minLbFt3)!.freightClass;
}

export interface FreightTerms {
  grossLb: number;
  /** Outside size, each side rounded up to the next whole inch, as carriers measure. */
  outsideIn: Vec3;
  /** From the rounded-up inches. */
  volumeFt3: number;
  /** `ceil(L × W × H in³ / freight.dimDivisorIn3PerLb)`. */
  dimWeightLb: number;
  /** The divisor used, so the UI can say it. */
  dimDivisorIn3PerLb: number;
  /** Gross lb / ft³. */
  densityLbFt3: number;
  /** Estimated density-based NMFC class (`NMFC_DENSITY_SCALE`). */
  freightClass: number;
}

/** LTL terms for one crate of `grossKg` with outside size `externalMm`. */
export function freightTerms(grossKg: number, externalMm: Vec3, standards: ShopStandards = DEFAULT_STANDARDS): FreightTerms {
  // Rounded to 1e-6 in first, so 914.4 mm is 36 in, not 36.000000000000004 → 37.
  const outsideIn = externalMm.map((v) => Math.ceil(Math.round((v / MM_PER_IN) * 1e6) / 1e6)) as Vec3;
  const in3 = outsideIn[0] * outsideIn[1] * outsideIn[2];
  const volumeFt3 = in3 / IN3_PER_FT3;
  const grossLb = grossKg * LB_PER_KG;
  const divisor = standards.freight.dimDivisorIn3PerLb;
  const densityLbFt3 = volumeFt3 > 0 ? grossLb / volumeFt3 : 0;
  return {
    grossLb,
    outsideIn,
    volumeFt3,
    dimWeightLb: Math.ceil(in3 / divisor),
    dimDivisorIn3PerLb: divisor,
    densityLbFt3,
    freightClass: freightClassFor(densityLbFt3),
  };
}

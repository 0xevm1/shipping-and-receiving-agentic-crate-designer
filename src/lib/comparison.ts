/**
 * The comparison summary of a multi-configuration bundle (spec §7.17): one row per
 * configuration with the numbers a PM chooses between (quantity per crate, crates, outside size,
 * gross weight, cost per part) and why the recommended quantity is the recommendation (the sweep,
 * §7.16). A pure model, laid out as a PDF by `comparisonPdf.ts`.
 *
 * No freight dollars appear: the app has no freight rates, so the sweep's score is crate cost per
 * part, and the summary says so. When the cost inputs are the shipped placeholders it says that
 * too.
 */
import { CONSTRAINT_TEXT } from "@/domain/explainRecommendation";
import type { CrateSettings, DesignPart } from "@/domain/schema";
import { describeShipment, type ShipmentPlan } from "@/domain/shipment";
import { costsArePlaceholder, PLACEHOLDER_COST_NOTE, type ShopStandards } from "@/domain/standards";
import type { QuantitySweep } from "@/domain/sweep";
import type { ExplanationText } from "./explanation";
import { documentDate, usdCents } from "./format";
import { renderMessage } from "./message";
import { isRecommended, recommendationWhy, type PrintableStamp, type Row } from "./printable";
import { dims, lengthUnit, weight, type Units } from "./units";

export interface ComparisonConfig {
  /** The configuration's folder in the bundle ("01-x34"). */
  label: string;
  part: DesignPart;
  plan: ShipmentPlan;
  standards: ShopStandards;
  /** The configuration's settings: the sweep's packing rules, for explaining the recommendation. */
  settings?: CrateSettings;
  /** The part's sweep under this configuration's rules, or null when none was run. */
  sweep: QuantitySweep | null;
}

export interface ComparisonRow {
  label: string;
  /** "34", or "30 / 20" for a split batch. */
  perCrate: string;
  crates: string;
  /** Crate A's outside size for a split batch. */
  outside: string;
  /** Gross per crate (crate A for a split batch). */
  gross: string;
  /** Crate cost per part, in dollars and cents. */
  costPerPart: string;
  recommended: boolean;
  /** Why this row is or isn't the recommendation, or what stops it. */
  note: string;
}

export interface Comparison {
  title: string;
  date: string;
  unitsNote: string;
  part: Row[];
  rows: ComparisonRow[];
  /** The sweep's recommendation, its rationale and the constraint that stopped a larger crate. */
  recommendation: { heading: string; rationale: string; stoppedBy: string | null; why: ExplanationText | null } | null;
  /** Cost basis and placeholder notes, always including that freight is not priced. */
  notes: string[];
  stamp?: PrintableStamp;
  createdAt?: string;
}

export interface ComparisonInput {
  configs: ComparisonConfig[];
  units: Units;
  generatedAt: string;
  timeZone?: string;
  stamp?: PrintableStamp;
}

const FREIGHT_NOT_PRICED = "Freight is not priced: no freight rates were given, so cost per part is the crate cost (wood, screws and labour) only.";

const costPerPart = (plan: ShipmentPlan) => plan.totals.costUsd / Math.max(1, plan.totals.parts);

function row(c: ComparisonConfig, u: Units): ComparisonRow {
  const { plan, sweep } = c;
  const first = plan.crates[0]?.result.design;
  if (plan.problem || !first) {
    const note = plan.problem ? `${plan.problem.title}. ${plan.problem.detail}` : "There is no crate.";
    return { label: c.label, perCrate: String(plan.totals.parts), crates: "-", outside: "-", gross: "-", costPerPart: "-", recommended: false, note };
  }
  const recommended = isRecommended(plan, sweep);
  const rec = sweep?.recommendation ?? null;
  const per = costPerPart(plan);
  let note: string;
  if (recommended) note = "Recommended";
  else if (plan.split) note = `Split: ${describeShipment(plan)}`;
  else {
    const point = sweep?.curve[plan.totals.parts - 1];
    if (point && !point.ok && point.binding && point.reason) note = `Fails the ${CONSTRAINT_TEXT[point.binding]}: ${renderMessage(point.reason, u)}`;
    else if (rec) {
      const delta = per - rec.crate.scoreUsdPerPart;
      note =
        Math.abs(delta) < 0.005
          ? "Same cost per part as the recommendation"
          : `${usdCents(Math.abs(delta))} a part ${delta > 0 ? "more" : "less"} than the recommendation`;
    } else note = "";
  }
  return {
    label: c.label,
    perCrate: plan.crates.map((t) => t.quantity).join(" / "),
    crates: String(plan.totals.crates),
    outside: `${dims(first.layout.external, u)} ${lengthUnit(u)}`,
    gross: weight(first.grossKg, u),
    costPerPart: usdCents(per),
    recommended,
    note,
  };
}

/** The comparison of `configs` (one part), in the selected units. Pure. */
export function buildComparison({ configs, units: u, generatedAt, timeZone, stamp }: ComparisonInput): Comparison {
  const part = configs[0]?.part;
  const from = configs.find((c) => c.sweep?.recommendation);
  const sweep = from?.sweep ?? null;
  const rec = sweep?.recommendation ?? null;
  const notes = [FREIGHT_NOT_PRICED];
  if (configs.some((c) => costsArePlaceholder(c.standards))) notes.push(PLACEHOLDER_COST_NOTE);
  return {
    title: part ? `Comparison: ${configs.length} configuration${configs.length === 1 ? "" : "s"} of ${part.name}` : "Comparison",
    date: documentDate(generatedAt, timeZone),
    unitsNote: u === "imperial" ? "Inches and pounds" : "Millimetres and kilograms",
    part: part
      ? [
          { label: "Part", value: part.id },
          { label: "Name", value: part.name },
          { label: "Material", value: part.material ?? "not given" },
          { label: "Mass each", value: weight(part.mass_kg, u) },
        ]
      : [],
    rows: configs.map((c) => row(c, u)),
    recommendation: rec
      ? {
          heading: `Recommended: ${rec.quantity} per crate, ${usdCents(rec.crate.scoreUsdPerPart)} a part in crate cost`,
          rationale: renderMessage(rec.rationale, u),
          stoppedBy: rec.stoppedBy
            ? `${rec.stoppedBy.quantity} per crate fails the ${CONSTRAINT_TEXT[rec.stoppedBy.binding]}: ${renderMessage(rec.stoppedBy.reason, u)}`
            : null,
          why: recommendationWhy(sweep, from!.standards, from!.settings, !!from!.part.profile, u),
        }
      : null,
    notes,
    ...(stamp ? { stamp, createdAt: generatedAt } : {}),
  };
}

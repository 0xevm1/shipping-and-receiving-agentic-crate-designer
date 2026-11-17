import { joinMessages, kg, mm, msg, parts, shopMm, type Message } from "./message";
import type { CrateSettings } from "./schema";
import { costsArePlaceholder, DEFAULT_STANDARDS, PLACEHOLDER_COST_NOTE, type ShopStandards } from "./standards";
import { SWEEP_CONSTRAINTS, type QuantitySweep, type ScoreBasis, type SweepConstraint, type SweepPoint, type SweepRecommendation } from "./sweep";

/**
 * Why the sweep recommends what it does (spec §7.16 "Explaining the recommendation"), in plain
 * words for the shipping PM: what was compared, how it is scored, why this quantity beat the
 * others, what stopped a larger crate, and what the answer assumes. Built from the sweep alone
 * (no number is invented here), so the Rules tab, the crate spec PDF and the comparison PDF say
 * the same thing. Lengths and masses stay `Message` quantities for the units toggle; dollars are
 * plain text, as in the sweep's rationale. Pure.
 */

/** The hard rule that stopped a crate, in a few words. */
export const CONSTRAINT_TEXT: Record<SweepConstraint, string> = {
  door: "trailer door and floor",
  stable: "stability",
  blocking: "room to block the parts",
  "base-rating": "base rating",
  "max-gross": "per-crate gross limit",
  "max-parts": "per-crate part limit",
};

export type ExplanationSectionId = "compared" | "score" | "pick" | "limit" | "considerations";

/** One titled block of plain sentences. */
export interface ExplanationSection {
  id: ExplanationSectionId;
  title: string;
  lines: Message[];
}

/** One line of the recommended crate's cost: `usd` null for freight that is not priced. */
export interface ExplanationCostLine {
  label: string;
  /** What the line counts ("202 screws at $8.00 per 100"), or null. */
  detail: string | null;
  usd: number | null;
  /** The crate's total and the score are sums, shown stronger. */
  total: boolean;
}

/** One quantity on the shortlist, against the pick. */
export interface ExplanationRow {
  quantity: number;
  scoreUsdPerPart: number;
  crateCostUsd: number;
  freightUsd: number | null;
  /** Score minus the pick's score: 0 for the pick. */
  vsPickUsdPerPart: number;
  picked: boolean;
}

/** A quantity on the chart: its score when it passes, or the rule that stopped it. */
export interface ExplanationCurvePoint {
  quantity: number;
  ok: boolean;
  scoreUsdPerPart: number | null;
  binding: SweepConstraint | null;
}

export interface RecommendationExplanation {
  quantity: number;
  layoutKey: string;
  basis: ScoreBasis;
  /** Any cost input is the shipped placeholder (`costsArePlaceholder`). */
  placeholderCosts: boolean;
  /** One sentence: the pick, its score and what limits it. */
  headline: Message;
  /** In order: compared, score, pick, limit, considerations. */
  sections: ExplanationSection[];
  /** The recommended crate's cost, wood to score. */
  costLines: ExplanationCostLine[];
  /** The shortlist, best first; the first row is the pick. */
  ranking: ExplanationRow[];
  /** Quantities 1 to a little past the last passing one: enough to see where crates stop passing. */
  curve: ExplanationCurvePoint[];
  tieBreak: SweepRecommendation["tieBreak"];
  /** What stopped a larger crate: a hard rule, cost, or nothing within the sweep. */
  limit: { kind: "constraint" | "cost" | "none"; quantity: number | null; binding: SweepConstraint | null };
}

/** What the explanation needs to know beyond the sweep. */
export interface ExplainOptions {
  /** The part's model outline has been measured (shaped blocking, §7.5b). */
  measured?: boolean;
}

/** Quantities past the last passing one that the chart shows. */
export const EXPLANATION_CURVE_TAIL = 4;

/** Dollars and cents with thousands separators: "$19.40", "$1,186.20". */
const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Build time to the minute: "2 h 43 m". */
const hm = (min: number) => {
  const t = Math.round(min);
  return t >= 60 ? `${Math.floor(t / 60)} h ${t % 60} m` : `${t} m`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "1–34, 36 and 40–42": runs of consecutive quantities. */
export function quantityRuns(qs: readonly number[]): string {
  const runs: string[] = [];
  for (let i = 0; i < qs.length;) {
    let j = i;
    while (j + 1 < qs.length && qs[j + 1] === qs[j] + 1) j++;
    runs.push(j === i ? String(qs[i]) : `${qs[i]}–${qs[j]}`);
    i = j + 1;
  }
  return runs.length > 1 ? `${runs.slice(0, -1).join(", ")} and ${runs[runs.length - 1]}` : (runs[0] ?? "none");
}

/**
 * The explanation of `sweep`'s recommendation, or null when there is none (a design problem, or
 * no quantity passes). `rules` are the packing rules it was swept under (the quantity is
 * ignored); `standards` the shop standards it used.
 */
export function explainRecommendation(
  sweep: QuantitySweep,
  standards: ShopStandards = DEFAULT_STANDARDS,
  rules: Pick<CrateSettings, "keepUpright" | "maxLayers" | "partGapMm" | "wallClearanceMm">,
  options: ExplainOptions = {},
): RecommendationExplanation | null {
  const rec = sweep.recommendation;
  if (!rec || sweep.problem) return null;
  const crate = rec.crate;
  const q = rec.quantity;
  const priced = sweep.basis === "crate-and-freight";
  const placeholderCosts = costsArePlaceholder(standards);
  const passing = sweep.curve.filter((p) => p.ok);
  const failing = sweep.curve.filter((p) => !p.ok);
  const above = sweep.curve.slice(q);
  const bestLarger = above.filter((p) => p.ok).sort((a, b) => a.crate!.scoreUsdPerPart - b.crate!.scoreUsdPerPart || b.quantity - a.quantity)[0] ?? null;
  const limit: RecommendationExplanation["limit"] = rec.costLimited
    ? { kind: "cost", quantity: bestLarger?.quantity ?? null, binding: null }
    : rec.stoppedBy
      ? { kind: "constraint", quantity: rec.stoppedBy.quantity, binding: rec.stoppedBy.binding }
      : { kind: "none", quantity: null, binding: null };
  const stop = rec.stoppedBy;

  // What was compared.
  const designed = sweep.curve.reduce((n, p) => n + p.layoutsDesigned, 0);
  const passedLayouts = sweep.curve.reduce((n, p) => n + p.layoutsPassed, 0);
  const skipped = sweep.curve.filter((p) => p.layoutsDesigned === 0).map((p) => p.quantity);
  const byRule = SWEEP_CONSTRAINTS.map((id) => ({ id, n: failing.filter((p) => p.binding === id).length })).filter((r) => r.n > 0);
  const compared: Message[] = [
    parts(
      `Every quantity per crate from 1 to ${sweep.maxQuantity}. For each, up to ${sweepLayoutsPerQuantity(sweep)} of the best layouts (ways to pack the parts) were designed in full: ${plural(designed, "crate")} in all, of which ${passedLayouts.toLocaleString("en-US")} passed every hard check.`,
    ),
    ...(skipped.length
      ? [parts(`${quantityRuns(skipped)} per crate were ruled out without designing: the parts alone break a limit (below), so no crate could pass.`)]
      : []),
    parts(
      `${plural(passing.length, "quantity", "quantities")} passed (${quantityRuns(passing.map((p) => p.quantity))}); ${plural(failing.length, "quantity", "quantities")} failed`,
      byRule.length ? `: ${byRule.map((r) => `${r.n} the ${CONSTRAINT_TEXT[r.id]}`).join(", ")}.` : ".",
    ),
  ];

  // How it is scored.
  const freightLine: ExplanationCostLine = priced
    ? { label: "Freight", detail: `class ${crate.freightClass}, on gross weight, from the rates given`, usd: crate.freightUsd, total: false }
    : { label: "Freight", detail: "no freight rates were given", usd: null, total: false };
  const costLines: ExplanationCostLine[] = [
    { label: "Wood", detail: "plywood and lumber", usd: crate.cost.woodUsd, total: false },
    {
      label: "Fasteners",
      detail: `${plural(crate.cost.screws, "screw")} at ${usd(standards.rates.screwCostUsdPer100)} per 100`,
      usd: crate.cost.fastenersUsd,
      total: false,
    },
    { label: "Labour", detail: `${hm(crate.cost.buildMin)} at ${usd(standards.labour.rateUsdPerHour)}/h`, usd: crate.cost.labourUsd, total: false },
    { label: "Crate cost", detail: null, usd: crate.crateCostUsd, total: true },
    freightLine,
    { label: "Per part", detail: priced ? `(crate + freight) ÷ ${q}` : `crate ÷ ${q}`, usd: crate.scoreUsdPerPart, total: true },
  ];
  const score: Message[] = [
    parts(
      "Each passing crate is scored by its cost per part moved: (crate cost + freight) ÷ parts in the crate. The lowest wins. Crate cost is the wood, the screws and the labour to build it, from the shop standards' prices and times.",
    ),
    priced
      ? parts(
          `Freight is priced from the rates given: per 100 lb of gross weight at the crate's estimated class, with the minimum charge per crate. ${q} per crate: ${usd(crate.crateCostUsd)} crate + ${usd(crate.freightUsd ?? 0)} freight = ${usd(crate.crateCostUsd + (crate.freightUsd ?? 0))}, ÷ ${q} = ${usd(crate.scoreUsdPerPart)} a part.`,
        )
      : parts(
          `${q} per crate: ${usd(crate.crateCostUsd)} ÷ ${q} = ${usd(crate.scoreUsdPerPart)} a part. Freight is not priced: no freight rates were given, so the score is the crate cost per part and no freight dollars are estimated.`,
        ),
    ...(placeholderCosts ? [parts(PLACEHOLDER_COST_NOTE)] : []),
  ];

  // Why this quantity.
  const runner = sweep.shortlist[1];
  const pick: Message[] = [
    rec.tieBreak && runner
      ? parts(`${q} per crate ties for the lowest cost per part, ${usd(crate.scoreUsdPerPart)}, with ${runner.quantity} per crate.`)
      : runner
        ? parts(
            `${q} per crate has the lowest cost per part of every passing quantity: ${usd(crate.scoreUsdPerPart)}. The runner-up, ${runner.quantity} per crate, is ${usd(runner.crate!.scoreUsdPerPart)}.`,
          )
        : parts(`${q} per crate is the only quantity that passes every hard check: ${usd(crate.scoreUsdPerPart)} a part.`),
    rec.tieBreak === "fewer-crates"
      ? parts(
          `${q} and ${runner!.quantity} per crate cost the same to the cent, so the tie went to fewer crates: ${q} per crate ships the same parts in fewer crates.`,
        )
      : rec.tieBreak === "denser-freight"
        ? parts(`Two layouts cost the same to the cent, so the tie went to the denser crate (more pounds per cubic foot, a lower freight class).`)
        : parts("Ties to the cent would go to fewer crates, then to the denser crate; none was needed here."),
  ];

  // What stopped a larger crate.
  const limitLines: Message[] =
    limit.kind === "cost"
      ? [
          parts(
            `Larger crates pass the checks but cost more per part: the best of them, ${bestLarger!.quantity} per crate, is ${usd(bestLarger!.crate!.scoreUsdPerPart)} a part (${usd(bestLarger!.crate!.scoreUsdPerPart - crate.scoreUsdPerPart)} more).`,
          ),
          stop
            ? msg`The first larger crate to fail a hard check is ${stop.quantity} per crate, on the ${CONSTRAINT_TEXT[stop.binding]}. ${stop.reason}`
            : parts(`Nothing up to ${sweep.maxQuantity} per crate fails a hard check.`),
        ]
      : limit.kind === "constraint"
        ? [msg`The next size up, ${stop!.quantity} per crate, fails a hard check: the ${CONSTRAINT_TEXT[stop!.binding]}. ${stop!.reason}`]
        : [parts(`Every quantity up to ${sweep.maxQuantity} per crate passes; none is cheaper per part.`)];

  const considerations = considerationsOf(standards, rules, options);
  const headline = parts(
    `${q} per crate: the lowest cost per part (${usd(crate.scoreUsdPerPart)}) of ${plural(passing.length, "quantity", "quantities")} that pass every hard check`,
    limit.kind === "constraint"
      ? msg`; ${rec.stoppedBy!.quantity} fails the ${CONSTRAINT_TEXT[rec.stoppedBy!.binding]}.`
      : limit.kind === "cost"
        ? "; larger crates cost more per part."
        : ".",
  );

  const lastOk = passing[passing.length - 1]?.quantity ?? q;
  const chartMax = Math.min(sweep.maxQuantity, Math.max(lastOk, rec.stoppedBy?.quantity ?? 0, q) + EXPLANATION_CURVE_TAIL);
  return {
    quantity: q,
    layoutKey: crate.layoutKey,
    basis: sweep.basis,
    placeholderCosts,
    headline,
    sections: [
      { id: "compared", title: "What was compared", lines: compared },
      { id: "score", title: "How it is scored", lines: score },
      { id: "pick", title: `Why ${q} per crate`, lines: pick },
      { id: "limit", title: "What stopped a larger crate", lines: limitLines },
      { id: "considerations", title: "What it takes into account", lines: considerations },
    ],
    costLines,
    ranking: sweep.shortlist.map((p) => ({
      quantity: p.quantity,
      scoreUsdPerPart: p.crate!.scoreUsdPerPart,
      crateCostUsd: p.crate!.crateCostUsd,
      freightUsd: p.crate!.freightUsd,
      vsPickUsdPerPart: p.crate!.scoreUsdPerPart - crate.scoreUsdPerPart,
      picked: p.quantity === q,
    })),
    curve: sweep.curve.slice(0, chartMax).map(curvePoint),
    tieBreak: rec.tieBreak,
    limit,
  };
}

const curvePoint = (p: SweepPoint): ExplanationCurvePoint => ({
  quantity: p.quantity,
  ok: p.ok,
  scoreUsdPerPart: p.crate?.scoreUsdPerPart ?? null,
  binding: p.binding,
});

/** The most layouts any quantity designed: the sweep's layouts per quantity. */
const sweepLayoutsPerQuantity = (sweep: QuantitySweep) => Math.max(1, ...sweep.curve.map((p) => p.layoutsDesigned));

/** The hard checks with the limits used, the scope, and the packing rules. */
function considerationsOf(standards: ShopStandards, rules: ExplainParams, options: ExplainOptions): Message[] {
  const lim = standards.limits;
  const van = lim.trailerMm;
  const { maxGrossKg, maxParts } = lim.perCrate;
  const checks: Message[] = [
    msg`fits a 53' dry van: through the ${mm(van.doorWidth)} × ${mm(van.doorHeight)} door and on the ${mm(van.interiorLength)} floor`,
    parts(`stable: height at most ${lim.stableHeightRatio}× the crate's short side`),
    msg`every part blocked in: at least ${shopMm(standards.construction.minBlockingGapMm)} beside each part for blocking`,
    parts(`within the base rating: the skids, joists and floor carry the payload with a ${standards.structure.loadFactor}× load factor`),
    msg`at most ${kg(maxGrossKg)} gross per crate`,
    parts(maxParts > 0 ? `at most ${maxParts} parts per crate` : "no limit on parts per crate"),
  ];
  return [
    parts("Hard checks, never traded for cost, with the limits from the shop standards: ", joinMessages(checks, "; "), "."),
    parts(
      "One part number per crate (identical parts only). Wood and basic fasteners only: plywood, lumber and screws, no packing materials. Domestic truck freight (LTL or a 53' dry van).",
    ),
    msg`Packing rules: ${rules.keepUpright ? "parts kept upright" : "parts may lie on any side (Keep upright is off)"}, at most ${plural(rules.maxLayers, "layer")}, ${shopMm(rules.partGapMm)} between parts and ${shopMm(rules.wallClearanceMm)} to the walls.`,
    options.measured
      ? parts("Blocking follows the part's measured outline.")
      : parts("Blocking is sized to the part's box until its model's outline is measured; the measured outline can change the crate and the recommendation."),
  ];
}

type ExplainParams = Pick<CrateSettings, "keepUpright" | "maxLayers" | "partGapMm" | "wallClearanceMm">;

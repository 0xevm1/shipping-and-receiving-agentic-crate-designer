import { z } from "zod";
import { designCrate } from "./crate";
import { smallestSideGap } from "./crateChecks";
import type { CrateDesign } from "./crateDesign";
import { inputProblem, rankLayouts, type DesignProblem } from "./design";
import { dimsMessage, kg, msg, parts, type Message } from "./message";
import type { Layout } from "./packing";
import type { CrateSettings, DesignPart } from "./schema";
import { sizeLimitText, withinOutsideLimits, withinSizeLimit } from "./shipment";
import { DEFAULT_STANDARDS, type ShopStandards } from "./standards";

/**
 * Choosing the best quantity (spec §7.16, #46): sweep every quantity per crate from 1 to
 * `SWEEP_MAX_QUANTITY`, design the best few layouts of each, drop every crate that fails a hard
 * check, and score the rest by **cost per part moved** = (crate cost + freight cost) ÷ parts.
 *
 * - **Hard checks first**, never traded for cost: the trailer door and floor, stability, every
 *   part blocked in, the base rating, and the per-crate size, gross and part limits (#25, #108). A quantity
 *   whose layouts all fail is never recommended, and its curve point says which rule stopped it.
 * - **Freight dollars only from caller-supplied rates** (`FreightRates`). Without them the score is
 *   the crate cost per part alone, `basis: "crate-only"`, and no freight figure is invented.
 * - **Ties** (to the cent per part) go to fewer crates, then to denser freight.
 *
 * `planTotal` turns the curve into a plan for a total of N parts: per-crate quantity and crate
 * count, split evenly so no crate holds less than about half the others.
 *
 * Pure and synchronous: about 30–150 ms for the sample parts (designed to run in a Web Worker).
 */

/** The largest quantity per crate the sweep tries; the quantity setting's own maximum. */
export const SWEEP_MAX_QUANTITY = 200;

/** Layouts designed per quantity, best first after the cheap hard checks (trailer, stable, blocking). */
export const SWEEP_LAYOUTS_PER_QUANTITY = 3;

/** How many quantities the shortlist holds, best first. */
export const SWEEP_SHORTLIST_SIZE = 5;

/** The hard rules, in the order a failing crate reports them. */
export const SWEEP_CONSTRAINTS = ["door", "stable", "blocking", "base-rating", "max-size", "max-gross", "max-parts"] as const;
export type SweepConstraint = (typeof SWEEP_CONSTRAINTS)[number];

/**
 * LTL rates a caller supplies (a logistics rate sheet): USD per hundredweight (100 lb) by NMFC
 * class, keyed by the class as text ("65", "92.5"), and a minimum charge per crate. A class
 * with no rate takes the next higher class's rate (dearer, so never an under-estimate), or the
 * highest class listed. Billed on gross weight, as LTL usually is.
 */
export const FreightRatesSchema = z.object({
  usdPerCwtByClass: z
    .record(z.string().regex(/^\d+(\.\d+)?$/), z.number().finite().min(0))
    .refine((r) => Object.keys(r).length > 0, "Give at least one class rate"),
  minimumUsd: z.number().finite().min(0).default(0),
});
export type FreightRates = z.input<typeof FreightRatesSchema>;

/** One crate's freight charge under `rates`. */
export function freightCostUsd(grossLb: number, freightClass: number, rates: FreightRates): number {
  const table = Object.entries(rates.usdPerCwtByClass)
    .map(([c, usd]) => ({ c: Number(c), usd }))
    .sort((a, b) => a.c - b.c);
  const row = table.find((r) => r.c >= freightClass) ?? table[table.length - 1];
  return Math.max(rates.minimumUsd ?? 0, (grossLb / 100) * row.usd);
}

/** One crate's cost by part (spec §7.12): the three add up to `SweepCrate.crateCostUsd`. */
export interface SweepCrateCost {
  /** Plywood and lumber. */
  woodUsd: number;
  /** Screws, at the shop's price per 100. */
  fastenersUsd: number;
  screws: number;
  /** Build time × the shop's labour rate. */
  labourUsd: number;
  /** Build time in minutes. */
  buildMin: number;
}

/** The crate the sweep picked for one quantity, and its score. */
export interface SweepCrate {
  layoutKey: string;
  /** Wood, screws and labour for one crate (`cost.totalUsd`). */
  crateCostUsd: number;
  /** What `crateCostUsd` is made of (spec §7.12), for explaining the score (§7.16). */
  cost: SweepCrateCost;
  /** One crate's freight charge, or null without freight rates. */
  freightUsd: number | null;
  /** (crate cost + freight) ÷ parts; crate cost ÷ parts without rates. */
  scoreUsdPerPart: number;
  grossKg: number;
  grossLb: number;
  volumeFt3: number;
  densityLbFt3: number;
  freightClass: number;
  externalVolumeM3: number;
}

/** One quantity on the curve: its best passing crate, or the rule that stopped it. */
export interface SweepPoint {
  quantity: number;
  ok: boolean;
  /** Set exactly when `ok` is false. */
  binding: SweepConstraint | null;
  /** Why it failed, as the failing check says it. */
  reason: Message | null;
  /** Set exactly when `ok` is true. */
  crate: SweepCrate | null;
  /** Layouts designed in full for this quantity: 0 when a monotonic limit failed it first. */
  layoutsDesigned: number;
  /** How many of those passed every hard check. */
  layoutsPassed: number;
}

export interface SweepRecommendation {
  quantity: number;
  crate: SweepCrate;
  /**
   * What stopped a larger crate: the first quantity above the recommendation that fails a hard
   * check and why, or null when every quantity up to the sweep's maximum passes.
   */
  stoppedBy: { quantity: number; binding: SweepConstraint; reason: Message } | null;
  /** True when a larger quantity passes every check but costs more per part. */
  costLimited: boolean;
  /**
   * Set when the runner-up scores the same to the cent per part and the order between them was
   * decided by the tie-break: `fewer-crates` (the larger quantity), else `denser-freight`.
   */
  tieBreak: "fewer-crates" | "denser-freight" | null;
  /** One or two sentences for the UI and the PDF. Dollars are plain text. */
  rationale: Message;
}

export type ScoreBasis = "crate-and-freight" | "crate-only";

export interface QuantitySweep {
  /** `crate-only` when no freight rates were given: no freight dollars anywhere. */
  basis: ScoreBasis;
  maxQuantity: number;
  /** Every quantity from 1 to `maxQuantity`, in order. Empty when there is a problem. */
  curve: SweepPoint[];
  /** The best passing quantities, best first (at most `SWEEP_SHORTLIST_SIZE`). */
  shortlist: SweepPoint[];
  /** Null when no quantity passes, or there is a problem. */
  recommendation: SweepRecommendation | null;
  problem: DesignProblem | null;
}

export interface SweepOptions {
  maxQuantity?: number;
  freightRates?: FreightRates | null;
  layoutsPerQuantity?: number;
}

/** Whole cents per part: smaller differences are rounding, not a better crate. */
const cents = (usd: number) => Math.round(usd * 100);

/** Best first: lowest cost per part, then fewer crates (more parts each), then denser freight. */
export function compareSweepPoints(a: SweepPoint, b: SweepPoint): number {
  const [x, y] = [a.crate!, b.crate!];
  return cents(x.scoreUsdPerPart) - cents(y.scoreUsdPerPart) || b.quantity - a.quantity || y.densityLbFt3 - x.densityLbFt3;
}

/** The first hard rule `d` (a crate of `k` parts) breaks, or null when it passes all of them. */
export function hardFailure(d: CrateDesign, k: number, standards: ShopStandards = DEFAULT_STANDARDS): { binding: SweepConstraint; reason: Message } | null {
  for (const id of ["door", "stable", "blocking", "base-rating"] as const) {
    const c = d.checks.find((x) => x.id === id);
    if (c?.level === "caution") return { binding: id, reason: c.detail };
  }
  const { maxGrossKg, maxParts } = standards.limits.perCrate;
  if (!withinSizeLimit(d.layout.external, standards)) {
    return {
      binding: "max-size",
      reason: msg`The crate is ${dimsMessage(d.layout.external)} outside, over the shop's size limit (${sizeLimitText(standards) ?? ""}).`,
    };
  }
  if (d.grossKg > maxGrossKg) return { binding: "max-gross", reason: msg`Gross ${kg(d.grossKg)} is over the ${kg(maxGrossKg)} per-crate limit.` };
  if (maxParts > 0 && k > maxParts) return { binding: "max-parts", reason: maxPartsReason(maxParts) };
  return null;
}

const maxPartsReason = (maxParts: number) => parts(`The shop allows at most ${maxParts} parts per crate.`);

/**
 * Sweeps quantities per crate from 1 to `maxQuantity` for `part` under `settings` (its
 * `quantity` is ignored) and `standards`. Never throws: input `computeDesign` can't design for
 * comes back as `problem`.
 */
export function sweepQuantities(
  part: DesignPart,
  settings: CrateSettings,
  standards: ShopStandards = DEFAULT_STANDARDS,
  options: SweepOptions = {},
): QuantitySweep {
  const maxQuantity = Math.max(1, Math.floor(options.maxQuantity ?? SWEEP_MAX_QUANTITY));
  const perQuantity = Math.max(1, options.layoutsPerQuantity ?? SWEEP_LAYOUTS_PER_QUANTITY);
  const rates = options.freightRates ? FreightRatesSchema.parse(options.freightRates) : null;
  const basis: ScoreBasis = rates ? "crate-and-freight" : "crate-only";
  const problem = inputProblem(part, { ...settings, quantity: 1 }, standards);
  if (problem) return { basis, maxQuantity, curve: [], shortlist: [], recommendation: null, problem };

  const { maxGrossKg, maxParts } = standards.limits.perCrate;
  const minGap = standards.construction.minBlockingGapMm;
  // The cheap hard checks, from the layout alone, so only promising layouts are designed.
  const cheapOk = (l: Layout) => l.stable && withinOutsideLimits(l.external, standards) && smallestSideGap(l, settings.partGapMm).mm >= minGap;

  const curve: SweepPoint[] = [];
  for (let q = 1; q <= maxQuantity; q++) {
    // Monotonic limits: once the parts alone are over the gross limit, every larger crate is too.
    if (maxParts > 0 && q > maxParts) {
      curve.push({ quantity: q, ok: false, binding: "max-parts", reason: maxPartsReason(maxParts), crate: null, layoutsDesigned: 0, layoutsPassed: 0 });
      continue;
    }
    if (part.mass_kg * q > maxGrossKg) {
      const reason = msg`${q} parts weigh ${kg(part.mass_kg * q)} before the crate, over the ${kg(maxGrossKg)} per-crate limit.`;
      curve.push({ quantity: q, ok: false, binding: "max-gross", reason, crate: null, layoutsDesigned: 0, layoutsPassed: 0 });
      continue;
    }
    const s = { ...settings, quantity: q };
    const ranked = rankLayouts(part, s, standards);
    const candidates = [...ranked.filter(cheapOk), ...ranked.filter((l) => !cheapOk(l))].slice(0, perQuantity);
    let best: SweepPoint | null = null;
    let firstFailure: ReturnType<typeof hardFailure> = null;
    let passed = 0;
    for (const layout of candidates) {
      const d = designCrate(part, s, layout, standards);
      const failure = hardFailure(d, q, standards);
      if (failure) {
        firstFailure ??= failure;
        continue;
      }
      passed++;
      const freightUsd = rates ? freightCostUsd(d.freight.grossLb, d.freight.freightClass, rates) : null;
      const point: SweepPoint = {
        quantity: q,
        ok: true,
        binding: null,
        reason: null,
        crate: {
          layoutKey: layout.key,
          crateCostUsd: d.cost.totalUsd,
          cost: { woodUsd: d.cost.woodUsd, fastenersUsd: d.cost.fastenersUsd, screws: d.screws, labourUsd: d.cost.labourUsd, buildMin: d.labour.totalMin },
          freightUsd,
          scoreUsdPerPart: (d.cost.totalUsd + (freightUsd ?? 0)) / q,
          grossKg: d.grossKg,
          grossLb: d.freight.grossLb,
          volumeFt3: d.freight.volumeFt3,
          densityLbFt3: d.freight.densityLbFt3,
          freightClass: d.freight.freightClass,
          externalVolumeM3: layout.externalVolumeM3,
        },
        layoutsDesigned: candidates.length,
        layoutsPassed: 0,
      };
      if (!best || compareSweepPoints(point, best) < 0) best = point;
    }
    curve.push(
      best
        ? { ...best, layoutsPassed: passed }
        : {
            quantity: q,
            ok: false,
            binding: firstFailure!.binding,
            reason: firstFailure!.reason,
            crate: null,
            layoutsDesigned: candidates.length,
            layoutsPassed: 0,
          },
    );
  }

  const shortlist = curve
    .filter((p) => p.ok)
    .sort(compareSweepPoints)
    .slice(0, SWEEP_SHORTLIST_SIZE);
  const top = shortlist[0];
  return { basis, maxQuantity, curve, shortlist, recommendation: top ? recommend(shortlist, curve, basis) : null, problem: null };
}

const usd = (v: number) => `$${v.toFixed(2)}`;

/** How the tie-break ordered `a` (the better) before `b`, or null when the score alone did. */
export function tieBreakBetween(a: SweepPoint, b: SweepPoint | undefined): SweepRecommendation["tieBreak"] {
  if (!b?.crate || cents(a.crate!.scoreUsdPerPart) !== cents(b.crate.scoreUsdPerPart)) return null;
  return a.quantity !== b.quantity ? "fewer-crates" : "denser-freight";
}

function recommend(shortlist: SweepPoint[], curve: SweepPoint[], basis: ScoreBasis): SweepRecommendation {
  const top = shortlist[0];
  const crate = top.crate!;
  const above = curve.slice(top.quantity);
  const fail = above.find((p) => !p.ok);
  const stoppedBy = fail ? { quantity: fail.quantity, binding: fail.binding!, reason: fail.reason! } : null;
  const costLimited = above.some((p) => p.ok);
  const per = basis === "crate-only" ? "in crate cost (no freight rates given, so freight is not priced)" : "in crate and freight cost";
  const head = msg`${top.quantity} per crate costs ${usd(crate.scoreUsdPerPart)} a part ${per}.`;
  const limit = stoppedBy
    ? costLimited
      ? msg` Larger crates cost more per part; from ${stoppedBy.quantity} parts a crate fails a hard check: ${stoppedBy.reason}`
      : msg` A crate of ${stoppedBy.quantity} fails a hard check: ${stoppedBy.reason}`
    : costLimited
      ? parts(" Larger crates cost more per part.")
      : parts(" Every quantity up to the sweep's maximum passes the checks.");
  return { quantity: top.quantity, crate, stoppedBy, costLimited, tieBreak: tieBreakBetween(top, shortlist[1]), rationale: parts(head, limit) };
}

/** One kind of crate in a total-quantity plan. */
export interface TotalCrateType {
  /** "A" for the fuller crates, "B" for the ones with one part fewer. */
  label: string;
  count: number;
  quantity: number;
  crate: SweepCrate;
}

export interface TotalPlan {
  total: number;
  crates: number;
  /** The most parts in any crate. */
  perCrate: number;
  /** One or two types whose quantities differ by at most one. */
  types: TotalCrateType[];
  crateCostUsd: number;
  /** Null without freight rates. */
  freightUsd: number | null;
  /** (crate cost + freight) ÷ total parts. */
  scoreUsdPerPart: number;
}

/**
 * `total` parts split as evenly as possible over `crates` crates: `total mod crates` crates of
 * ⌈total / crates⌉ and the rest of ⌊total / crates⌋. The two sizes differ by at most one, so no
 * crate holds less than about half the others.
 */
export function evenSplit(total: number, crates: number): { quantity: number; count: number }[] {
  const lo = Math.floor(total / crates);
  const extra = total - lo * crates;
  return [...(extra > 0 ? [{ quantity: lo + 1, count: extra }] : []), ...(crates - extra > 0 && lo > 0 ? [{ quantity: lo, count: crates - extra }] : [])];
}

/**
 * Total-quantity mode: how `total` parts ship, from a sweep of the part. Tries every crate count
 * whose even split uses only passing quantities on the curve, and keeps the lowest cost per
 * part; ties go to fewer crates. Null when no even split passes (one
 * part alone fails a hard check, or the split needs crates larger than the sweep tried).
 */
export function planTotal(sweep: QuantitySweep, total: number): TotalPlan | null {
  const n = Math.floor(total);
  if (!(n >= 1) || sweep.problem) return null;
  const at = (q: number) => sweep.curve[q - 1];
  let best: TotalPlan | null = null;
  for (let crates = Math.ceil(n / sweep.maxQuantity); crates <= n; crates++) {
    const split = evenSplit(n, crates);
    if (!split.every((t) => at(t.quantity)?.ok)) continue;
    const types = split.map((t, i) => ({ label: i ? "B" : "A", ...t, crate: at(t.quantity).crate! }));
    const sum = (f: (c: SweepCrate) => number) => types.reduce((s, t) => s + t.count * f(t.crate), 0);
    const crateCostUsd = sum((c) => c.crateCostUsd);
    const freightUsd = sweep.basis === "crate-only" ? null : sum((c) => c.freightUsd ?? 0);
    const scoreUsdPerPart = (crateCostUsd + (freightUsd ?? 0)) / n;
    // Crate counts are tried fewest first, so a tie on cost keeps the fewer crates. Each count has
    // exactly one even split, so the density tie-break of the sweep never arises here.
    if (!best || cents(scoreUsdPerPart) < cents(best.scoreUsdPerPart)) {
      best = { total: n, crates, perCrate: split[0].quantity, types, crateCostUsd, freightUsd, scoreUsdPerPart };
    }
  }
  return best;
}

import { designCrate, type BomLine, type Check, type CrateDesign } from "./crate";
import { computeDesign, rankByObjective, rankLayouts, type DesignProblem, type DesignResult, type Ranking } from "./design";
import type { Layout } from "./packing";
import type { CrateSettings, DesignPart, Vec3 } from "./schema";
import { DEFAULT_STANDARDS, type ShopStandards } from "./standards";

/**
 * Shipment planning (#25, spec §7.10): how a batch ships when one crate would break a
 * per-crate limit (gross weight, the trailer door and floor, or a part count).
 *
 * A batch that fits one crate is today's single design, unchanged. Otherwise it ships as
 * N identical crates of k parts plus at most one remainder crate of r < k parts, with k
 * chosen for the fewest crates, then the least outside volume (within the layout volume
 * tie), then the most even split. Each crate type is a full `CrateDesign` from the normal
 * pipeline, so it has its own layouts, cut list and checks. Pure and synchronous.
 */

export interface CrateType {
  /** "A" for the identical crates, "B" for the remainder. */
  label: string;
  /** How many of this crate ship. */
  count: number;
  /** Parts in each crate of this type. */
  quantity: number;
  /** The crate's layouts and design, as `computeDesign` returns them for `quantity` parts. */
  result: DesignResult;
}

export interface ShipmentTotals {
  crates: number;
  parts: number;
  payloadKg: number;
  tareKg: number;
  grossKg: number;
  /** Sum of every crate's outside volume. */
  volumeM3: number;
  materialCostUsd: number;
  /** Every crate's total build cost: wood, screws and labour (#17). */
  costUsd: number;
  /** Every crate's build time. */
  labourHours: number;
  /** Sum of every crate's dimensional weight, lb. */
  dimWeightLb: number;
}

export interface ShipmentPlan {
  /** True when the batch ships in more than one crate. */
  split: boolean;
  /** One or two crate types: the identical crates, then the remainder. */
  crates: CrateType[];
  totals: ShipmentTotals;
  /** Why the limits can't all be met (one part alone is over them), or null. */
  unmet: string | null;
  /** The design problem (§7.9), when there is no crate at all. */
  problem: DesignProblem | null;
}

/** True when a crate's outside size fits through the trailer door and on its floor (`limits.trailerMm`). */
export function withinOutsideLimits(external: Vec3, standards: ShopStandards = DEFAULT_STANDARDS): boolean {
  const t = standards.limits.trailerMm;
  return external[0] <= t.interiorLength && external[1] <= t.doorWidth && external[2] <= t.doorHeight;
}

interface Candidate {
  quantity: number;
  result: DesignResult;
  fits: boolean;
}

/**
 * Plans how `settings.quantity` parts ship. `layoutKey` picks a layout for the crate type
 * that has it (the user's pick on the Layouts tab); the split itself uses each type's
 * recommended layout.
 */
export function planShipment(
  part: DesignPart,
  settings: CrateSettings,
  layoutKey?: string | null,
  standards: ShopStandards = DEFAULT_STANDARDS,
  ranking: Ranking = "volume",
): ShipmentPlan {
  const { maxGrossKg, maxParts } = standards.limits.perCrate;
  const total = settings.quantity;
  const inside = (l: Layout) => withinOutsideLimits(l.external, standards);
  // Gross within the smaller of the per-crate limit and the computed base rating (#7, as gross).
  const fitsLimits = (d: CrateDesign, k: number) =>
    inside(d.layout) && d.grossKg <= crateGrossLimitKg(d, standards) && (maxParts === 0 || k <= maxParts);
  const layoutMemo = new Map<number, Layout[]>();
  const memo = new Map<number, Candidate>();

  /** Layouts for `k` parts, best first, with those that fit the trailer ahead of those that don't. */
  const layoutsFor = (k: number): Layout[] => {
    let layouts = layoutMemo.get(k);
    if (!layouts) {
      const ranked = rankLayouts(part, { ...settings, quantity: k }, standards);
      layouts = inside(ranked[0]) ? ranked : [...ranked.filter(inside), ...ranked.filter((l) => !inside(l))];
      layoutMemo.set(k, layouts);
    }
    return layouts;
  };
  /** Outside volume of the recommended crate for `k` parts (no crate is designed). */
  const volumeFor = (k: number) => layoutsFor(k)[0].externalVolumeM3;

  /** The crate for `k` parts on its recommended layout, and whether it is within every limit. */
  const candidate = (k: number): Candidate => {
    const hit = memo.get(k);
    if (hit) return hit;
    const layouts = layoutsFor(k);
    const design = designCrate(part, { ...settings, quantity: k }, layouts[0], standards);
    const c = { quantity: k, result: { layouts, design, problem: null }, fits: fitsLimits(design, k) };
    memo.set(k, c);
    return c;
  };

  /**
   * A crate type's layouts re-ranked by the ranking option (#17), with the per-crate limits as
   * a hard constraint ahead of stability and blocking. The split itself is chosen by volume.
   */
  const ranked = (result: DesignResult, k: number): DesignResult => {
    if (ranking === "volume" || !result.design) return result;
    const r = rankByObjective(part, { ...settings, quantity: k }, result.layouts, ranking, standards, (d) => fitsLimits(d, k));
    return { ...result, layouts: r.layouts, design: r.designs.get(r.layouts[0].key) ?? result.design };
  };

  const single = computeDesign(part, settings, null, standards);
  if (!single.design) return plan([{ label: "A", count: 1, quantity: total, result: single }], null, standards);
  // Reuse the design already made, unless its layout had to be skipped for the trailer.
  if (inside(single.design.layout)) {
    layoutMemo.set(total, single.layouts);
    memo.set(total, { quantity: total, result: single, fits: fitsLimits(single.design, total) });
  }
  const whole = candidate(total);
  if (whole.fits || total === 1) {
    // One crate: exactly `computeDesign`, unless a layout had to be skipped for the trailer.
    const result = withLayout(ranked(whole.result, total), part, settings, layoutKey, standards);
    return plan([{ label: "A", count: 1, quantity: total, result }], null, standards);
  }

  if (!candidate(1).fits) {
    const unmet = `One part alone is over the per-crate limit (${limitText(standards)}), so each part ships in its own crate.`;
    const result = withLayout(ranked(candidate(1).result, 1), part, { ...settings, quantity: 1 }, layoutKey, standards);
    return plan([{ label: "A", count: total, quantity: 1, result }], unmet, standards);
  }

  // Largest k that fits, by bisection: feasibility falls as k grows (more weight, a bigger crate).
  const byWeight = Math.floor(maxGrossKg / part.mass_kg);
  let lo = 1;
  let hi = Math.max(1, Math.min(total - 1, maxParts || total, byWeight));
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (candidate(mid).fits) lo = mid;
    else hi = mid - 1;
  }
  const kMax = lo;
  const crates = Math.ceil(total / kMax);

  // Every k from ceil(total / crates) to kMax ships in the fewest crates. Compare their
  // volumes from the layouts alone, and design crates only to confirm the front-runners fit.
  interface Option {
    k: number;
    full: number;
    rest: number;
    volume: number;
    /** k - r: 0 for no remainder, small for an even split. */
    spread: number;
  }
  const options: Option[] = [];
  for (let k = Math.ceil(total / crates); k <= kMax; k++) {
    const full = Math.floor(total / k);
    const rest = total - full * k;
    options.push({ k, full, rest, volume: full * volumeFor(k) + (rest > 0 ? volumeFor(rest) : 0), spread: rest > 0 ? k - rest : 0 });
  }
  const feasible = (o: Option) => candidate(o.k).fits && (o.rest === 0 || candidate(o.rest).fits);
  const least = [...options].sort((x, y) => x.volume - y.volume).find(feasible)?.volume ?? Infinity;
  const tie = least * (1 + standards.defaults.volumeTolerance);
  const full = Math.floor(total / kMax);
  const best =
    options
      .filter((o) => o.volume <= tie)
      .sort((x, y) => x.spread - y.spread || x.volume - y.volume || y.k - x.k)
      .find(feasible) ?? { k: kMax, full, rest: total - full * kMax };

  const types: CrateType[] = [
    { label: "A", count: best.full, quantity: best.k, result: ranked(candidate(best.k).result, best.k) },
  ];
  if (best.rest > 0) types.push({ label: "B", count: 1, quantity: best.rest, result: ranked(candidate(best.rest).result, best.rest) });
  // The user's layout pick applies to the first crate type that has that layout.
  const picked = types.findIndex((t) => t.result.layouts.some((l) => l.key === layoutKey));
  if (picked >= 0) {
    const t = types[picked];
    t.result = withLayout(t.result, part, { ...settings, quantity: t.quantity }, layoutKey, standards);
  }
  return plan(types, null, standards);
}

/**
 * The most a crate may weigh (#25 with #7): the smaller of `limits.perCrate.maxGrossKg` and the
 * base rating as a gross weight (`structure.ratedPayloadKg + tareKg`, so the payload is within
 * the rating).
 */
export function crateGrossLimitKg(d: CrateDesign, standards: ShopStandards = DEFAULT_STANDARDS): number {
  return Math.min(standards.limits.perCrate.maxGrossKg, d.structure.ratedPayloadKg + d.tareKg);
}

/** `result` with the layout `key` designed, when it has that layout and it isn't already shown. */
function withLayout(
  result: DesignResult,
  part: DesignPart,
  settings: CrateSettings,
  key: string | null | undefined,
  standards: ShopStandards,
): DesignResult {
  if (!key || !result.design || result.design.layout.key === key) return result;
  const layout = result.layouts.find((l) => l.key === key);
  return layout ? { ...result, design: designCrate(part, settings, layout, standards) } : result;
}

function plan(types: CrateType[], unmet: string | null, standards: ShopStandards): ShipmentPlan {
  const split = types.reduce((n, t) => n + t.count, 0) > 1;
  if (split) {
    const text = describeShipment({ crates: types });
    for (const t of types) {
      const d = t.result.design;
      if (d) t.result = { ...t.result, design: { ...d, checks: [...d.checks, crateLimitCheck(text, unmet, standards)] } };
    }
  }
  const sum = (f: (d: CrateDesign) => number) => types.reduce((n, t) => n + (t.result.design ? t.count * f(t.result.design) : 0), 0);
  return {
    split,
    crates: types,
    totals: {
      crates: types.reduce((n, t) => n + t.count, 0),
      parts: types.reduce((n, t) => n + t.count * t.quantity, 0),
      payloadKg: sum((d) => d.payloadKg),
      tareKg: sum((d) => d.tareKg),
      grossKg: sum((d) => d.grossKg),
      volumeM3: sum((d) => d.layout.externalVolumeM3),
      materialCostUsd: sum((d) => d.materialCostUsd),
      costUsd: sum((d) => d.cost.totalUsd),
      labourHours: sum((d) => d.labour.hours),
      dimWeightLb: sum((d) => d.dimWeightLb),
    },
    unmet,
    problem: types[0].result.problem,
  };
}

const kgText = (v: number) => `${Math.round(v).toLocaleString("en-US")} kg`;

/** "1,000 kg gross, 40 parts and the trailer door": the limits in force, for messages. */
function limitText(standards: ShopStandards): string {
  const { maxGrossKg, maxParts } = standards.limits.perCrate;
  return [`${kgText(maxGrossKg)} gross or the base rating`, ...(maxParts > 0 ? [`${maxParts} parts`] : []), "the trailer door and floor"].join(", ");
}

function crateLimitCheck(text: string, unmet: string | null, standards: ShopStandards): Check {
  return unmet
    ? { id: "crate-limit", level: "caution", title: "Over the per-crate limit", detail: unmet }
    : {
        id: "crate-limit",
        level: "ok",
        title: "Within the per-crate limits",
        detail: `The batch ships as ${text}, so no crate is over ${limitText(standards)}.`,
      };
}

/** "3 × crate A (64 each) + 1 × crate B (8)". */
export function describeShipment(plan: { crates: Pick<CrateType, "label" | "count" | "quantity">[] }): string {
  return plan.crates
    .map((t) => `${t.count} × crate ${t.label} (${t.quantity}${t.count > 1 ? " each" : ""})`)
    .join(" + ");
}

export interface ShipmentBom {
  /** Cut-list lines for every crate, each crate type's quantities × its count, equal pieces merged. */
  lines: BomLine[];
  plywoodM2: number;
  lumberM: number;
  screws: number;
}

/** The cut list for the whole shipment. For one crate it is that crate's cut list. */
export function shipmentBom(plan: ShipmentPlan): ShipmentBom {
  const lines = new Map<string, BomLine>();
  let plywoodM2 = 0;
  let lumberM = 0;
  let screws = 0;
  for (const t of plan.crates) {
    const d = t.result.design;
    if (!d) continue;
    for (const l of d.bom) {
      const line = lines.get(l.key);
      if (line) line.qty += l.qty * t.count;
      else lines.set(l.key, { ...l, qty: l.qty * t.count });
    }
    plywoodM2 += d.plywoodM2 * t.count;
    lumberM += d.lumberM * t.count;
    screws += d.screws * t.count;
  }
  // Keep each piece's sizes together (crate A's floor, then crate B's), in first-seen order.
  const all = [...lines.values()];
  const firstSeen = new Map<string, number>();
  all.forEach((l, i) => firstSeen.set(`${l.assembly}|${l.label}`, firstSeen.get(`${l.assembly}|${l.label}`) ?? i));
  const order = (l: BomLine) => firstSeen.get(`${l.assembly}|${l.label}`)!;
  if (plan.crates.length > 1) all.sort((x, y) => order(x) - order(y));
  return { lines: all, plywoodM2, lumberM, screws };
}

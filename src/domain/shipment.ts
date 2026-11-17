import { z } from "zod";
import { tellApart, type BomLine } from "./bom";
import type { Check } from "./check";
import { designCrate } from "./crate";
import type { CrateDesign } from "./crateDesign";
import { computeDesign, rankByObjective, rankLayouts, type DesignProblem, type DesignResult, type Ranking } from "./design";
import { dimsMessage, joinMessages, kg, mm, msg, parts, type Message } from "./message";
import type { Layout } from "./packing";
import { sheetsFromAreas, type SheetsNeeded } from "./sheets";
import type { CrateSettings, DesignPart, Vec3 } from "./schema";
import { DEFAULT_STANDARDS, type ShopStandards } from "./standards";

/**
 * Shipment planning (spec §7.10): how a batch ships when one crate would break a
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

interface ShipmentTotals {
  crates: number;
  parts: number;
  payloadKg: number;
  tareKg: number;
  grossKg: number;
  /** Sum of every crate's outside volume. */
  volumeM3: number;
  materialCostUsd: number;
  /** Every crate's total build cost: wood, screws and labour. */
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
  unmet: Message | null;
  /** The design problem (§7.9), when there is no crate at all. */
  problem: DesignProblem | null;
  /**
   * Set when the plan is a job's total quantity (`planTotalShipment`, #140): the parts to ship,
   * which the crate types add up to. Absent for a batch planned by `planShipment`.
   */
  total?: number;
}

/**
 * How a total quantity ships (#140): the crate types of `planTotal`'s even split, with the layout
 * the sweep chose for each. This is what a design request carries to make every shipment-level
 * output describe the whole shipment; the crates are designed from it, never re-planned.
 */
export const TotalSplitSchema = z
  .object({
    /** The parts to ship. */
    parts: z.int().min(1),
    /** One or two crate types, the fuller first (labels A and B). */
    types: z
      .array(
        z.object({
          count: z.int().positive(),
          quantity: z.int().min(1).max(200),
          /** The layout the sweep chose for this quantity; null: the recommended one. */
          layoutKey: z.string().nullable(),
        }),
      )
      .min(1)
      .max(2),
  })
  .refine((t) => t.types.reduce((n, x) => n + x.count * x.quantity, 0) === t.parts, { path: ["types"], message: "the crate types don't add up to the parts" });
export type TotalSplit = z.infer<typeof TotalSplitSchema>;

/**
 * The shipment for a total quantity (#140): each crate type of `split` designed on its layout, as
 * `planShipment` designs a crate type, so the whole shipment (counts, gross, lumber, cost, labour)
 * and each type's build sheet, cut list, label and model come from the same crates the sweep
 * priced. Nothing is searched: it costs two single designs, whatever the total. `settings.quantity`
 * is not read.
 */
export function planTotalShipment(
  part: DesignPart,
  settings: CrateSettings,
  split: TotalSplit,
  standards: ShopStandards = DEFAULT_STANDARDS,
  ranking: Ranking = "volume",
): ShipmentPlan {
  const types: CrateType[] = split.types.map((t, i) => ({
    label: i ? "B" : "A",
    count: t.count,
    quantity: t.quantity,
    result: computeDesign(part, { ...settings, quantity: t.quantity }, t.layoutKey, standards, ranking),
  }));
  return { ...plan(types, null, standards), total: split.parts };
}

/**
 * True when a crate's outside size is within the shop's own size limit (`limits.perCrate.maxOutsideMm`,
 * 0 on a side = no limit there). The crate may be turned on the floor, so length and width may
 * swap: it passes when it fits either way round. Height never swaps.
 */
export function withinSizeLimit(external: Vec3, standards: ShopStandards = DEFAULT_STANDARDS): boolean {
  const { length, width, height } = standards.limits.perCrate.maxOutsideMm;
  const [l, w, h] = external;
  const under = (v: number, max: number) => max === 0 || v <= max;
  return under(h, height) && ((under(l, length) && under(w, width)) || (under(w, length) && under(l, width)));
}

/**
 * The sides of a crate that are over the shop's size limit, each with its size and its limit, in the
 * orientation that is over on the fewest (length and width may swap, as in `withinSizeLimit`; a tie
 * keeps the crate as drawn). Empty when it is within the limit.
 */
export function sizeOverSides(
  external: Vec3,
  standards: ShopStandards = DEFAULT_STANDARDS,
): { side: "length" | "width" | "height"; mm: number; maxMm: number }[] {
  const { length, width, height } = standards.limits.perCrate.maxOutsideMm;
  const [l, w, h] = external;
  const over = (side: "length" | "width" | "height", v: number, max: number) => (max > 0 && v > max ? [{ side, mm: v, maxMm: max }] : []);
  const asDrawn = [...over("length", l, length), ...over("width", w, width)];
  const turned = [...over("length", w, length), ...over("width", l, width)];
  return [...(turned.length < asDrawn.length ? turned : asDrawn), ...over("height", h, height)];
}

/**
 * True when a crate's outside size fits through the trailer door and on its floor (`limits.trailerMm`)
 * and is within the shop's own size limit (`limits.perCrate.maxOutsideMm`).
 */
export function withinOutsideLimits(external: Vec3, standards: ShopStandards = DEFAULT_STANDARDS): boolean {
  const t = standards.limits.trailerMm;
  return external[0] <= t.interiorLength && external[1] <= t.doorWidth && external[2] <= t.doorHeight && withinSizeLimit(external, standards);
}

/** The size limit in words ("1,200 × 1,000 × 1,000 mm, length and width either way round"), or null when there is none. */
export function sizeLimitText(standards: ShopStandards): Message | null {
  const { length, width, height } = standards.limits.perCrate.maxOutsideMm;
  if (length === 0 && width === 0 && height === 0) return null;
  if (length > 0 && width > 0 && height > 0) return msg`${dimsMessage([length, width, height])} outside, length and width either way round`;
  const sides = (
    [
      ["length", length],
      ["width", width],
      ["height", height],
    ] as const
  ).filter(([, v]) => v > 0);
  return msg`outside ${joinMessages(
    sides.map(([name, v]) => msg`${name} ${mm(v)}`),
    ", ",
  )} at most`;
}

interface Candidate {
  quantity: number;
  result: DesignResult;
  fits: boolean;
}

/**
 * Plans how `settings.quantity` parts ship. `layoutKey` picks a layout for the crate type
 * that has it (the user's pick on the Layouts tab). A picked layout for the whole batch that is
 * within every limit keeps the batch in one crate; otherwise the split uses each type's
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
  // Gross within the smaller of the per-crate limit and the computed base rating (as a gross weight).
  const fitsLimits = (d: CrateDesign, k: number) => inside(d.layout) && d.grossKg <= crateGrossLimitKg(d, standards) && (maxParts === 0 || k <= maxParts);
  const sizeOk = (l: Layout) => withinSizeLimit(l.external, standards);
  /** Layouts over the shop's size limit are not offered, unless every one is (then the batch splits). */
  const offered = (layouts: Layout[]): Layout[] => (layouts.some(sizeOk) ? layouts.filter(sizeOk) : layouts);
  const layoutMemo = new Map<number, Layout[]>();
  const memo = new Map<number, Candidate>();

  /** Layouts for `k` parts, best first, with those that fit the trailer ahead of those that don't. */
  const layoutsFor = (k: number): Layout[] => {
    let layouts = layoutMemo.get(k);
    if (!layouts) {
      const ranked = rankLayouts(part, { ...settings, quantity: k }, standards);
      const within = offered(ranked);
      layouts = inside(within[0]) ? within : [...within.filter(inside), ...within.filter((l) => !inside(l))];
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
   * A crate type's layouts re-ranked by the ranking option, with the per-crate limits as
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
    const layouts = offered(single.layouts);
    layoutMemo.set(total, layouts);
    memo.set(total, { quantity: total, result: { ...single, layouts }, fits: fitsLimits(single.design, total) });
  }
  const whole = candidate(total);
  // The user's pick for the whole batch counts too: a batch ships in one crate when the crate on
  // the picked layout is within every limit, even when the recommended one isn't. So a quantity
  // and layout the sweep recommends (§7.16, whose hard checks imply these limits) never splits.
  const pick = layoutKey && layoutKey !== whole.result.design?.layout.key ? whole.result.layouts.find((l) => l.key === layoutKey) : undefined;
  const pickDesign = pick && !whole.fits ? designCrate(part, settings, pick, standards) : null;
  if (pickDesign && fitsLimits(pickDesign, total)) {
    return plan([{ label: "A", count: 1, quantity: total, result: { ...ranked(whole.result, total), design: pickDesign } }], null, standards);
  }
  if (whole.fits) {
    // One crate: exactly `computeDesign`, unless a layout had to be skipped for the trailer.
    const result = withLayout(ranked(whole.result, total), part, settings, layoutKey, standards);
    return plan([{ label: "A", count: 1, quantity: total, result }], null, standards);
  }

  if (!candidate(1).fits) {
    // One part alone breaks a limit (#144): each part ships in its own crate and the check says so, even for a batch of one.
    const one = candidate(1).result;
    const alone =
      total === 1
        ? msg`This part's crate is over the per-crate limit (${limitText(standards)}).`
        : msg`One part alone is over the per-crate limit (${limitText(standards)}), so each part ships in its own crate.`;
    const unmet = parts(alone, " ", overText(one.design!, standards));
    const result = withLayout(ranked(one, 1), part, { ...settings, quantity: 1 }, layoutKey, standards);
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
  const best = options
    .filter((o) => o.volume <= tie)
    .sort((x, y) => x.spread - y.spread || x.volume - y.volume || y.k - x.k)
    .find(feasible) ?? { k: kMax, full, rest: total - full * kMax };

  const types: CrateType[] = [{ label: "A", count: best.full, quantity: best.k, result: ranked(candidate(best.k).result, best.k) }];
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
 * The most a crate may weigh: the smaller of `limits.perCrate.maxGrossKg` and the
 * base rating as a gross weight (`structure.ratedPayloadKg + tareKg`, so the payload is within
 * the rating).
 */
export function crateGrossLimitKg(d: CrateDesign, standards: ShopStandards = DEFAULT_STANDARDS): number {
  return Math.min(standards.limits.perCrate.maxGrossKg, d.structure.ratedPayloadKg + d.tareKg);
}

/** `result` with the layout `key` designed, when it has that layout and it isn't already shown. */
function withLayout(result: DesignResult, part: DesignPart, settings: CrateSettings, key: string | null | undefined, standards: ShopStandards): DesignResult {
  if (!key || !result.design || result.design.layout.key === key) return result;
  const layout = result.layouts.find((l) => l.key === key);
  return layout ? { ...result, design: designCrate(part, settings, layout, standards) } : result;
}

function plan(types: CrateType[], unmet: Message | null, standards: ShopStandards): ShipmentPlan {
  const split = types.reduce((n, t) => n + t.count, 0) > 1;
  // A crate that can't meet the limits gets the caution even when it is the only one (#144).
  if (split || unmet) {
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
      dimWeightLb: sum((d) => d.freight.dimWeightLb),
    },
    unmet,
    problem: types[0].result.problem,
  };
}

/** What a crate of one part is over, as a sentence: the sides over the size limit (with the limit), the gross weight, the trailer. */
function overText(d: CrateDesign, standards: ShopStandards): Message {
  const [l, w, h] = d.layout.external;
  const items: Message[] = [];
  const sides = sizeOverSides(d.layout.external, standards);
  if (sides.length) {
    items.push(
      msg`the ${joinMessages(
        sides.map((s) => msg`${s.side} (${mm(s.mm)} against ${mm(s.maxMm)})`),
        ", ",
      )} is over the size limit`,
    );
  }
  const maxGross = crateGrossLimitKg(d, standards);
  if (d.grossKg > maxGross) items.push(msg`the gross weight ${kg(d.grossKg)} is over the ${kg(maxGross)} limit`);
  const t = standards.limits.trailerMm;
  if (l > t.interiorLength || w > t.doorWidth || h > t.doorHeight) items.push(parts("it does not fit the trailer door and floor"));
  return items.length ? msg`The crate is ${dimsMessage([l, w, h])} outside and ${joinMessages(items, "; ")}.` : [];
}

/** "1,000 kg gross, 40 parts, 1,200 × 1,000 × 1,000 mm outside and the trailer door": the limits in force, for messages. */
function limitText(standards: ShopStandards): Message {
  const { maxGrossKg, maxParts } = standards.limits.perCrate;
  const size = sizeLimitText(standards);
  const limits = [
    msg`${kg(maxGrossKg)} gross or the base rating`,
    ...(maxParts > 0 ? [parts(`${maxParts} parts`)] : []),
    ...(size ? [size] : []),
    parts("the trailer door and floor"),
  ];
  return joinMessages(limits, ", ");
}

function crateLimitCheck(text: string, unmet: Message | null, standards: ShopStandards): Check<"crate-limit"> {
  return unmet
    ? { id: "crate-limit", level: "caution", title: "Over the per-crate limit", detail: unmet }
    : {
        id: "crate-limit",
        level: "ok",
        title: "Within the per-crate limits",
        detail: msg`The batch ships as ${text}, so no crate is over ${limitText(standards)}.`,
      };
}

/** "3 × crate A (64 each) + 1 × crate B (8)". */
/**
 * Crate cost per part shipped, USD (wood, screws and labour, §7.12, without freight): what a saved
 * configuration is scored and listed by, in the browser, on the server and in the files (#46). Null
 * when nothing ships.
 */
export function crateCostPerPart(totals: { costUsd: number; parts: number }): number | null {
  return totals.parts > 0 ? totals.costUsd / totals.parts : null;
}

export function describeShipment(plan: { crates: Pick<CrateType, "label" | "count" | "quantity">[] }): string {
  return plan.crates.map((t) => `${t.count} × crate ${t.label} (${t.quantity}${t.count > 1 ? " each" : ""})`).join(" + ");
}

interface ShipmentBom {
  /** Cut-list lines for every crate, each crate type's quantities × its count, equal pieces merged. */
  lines: BomLine[];
  plywoodM2: number;
  lumberM: number;
  /** Plywood sheets for every crate together: the pieces' area by thickness is summed first, so crates share offcuts. */
  sheets: SheetsNeeded;
  screws: number;
}

/** The cut list for the whole shipment. For one crate it is that crate's cut list. */
export function shipmentBom(plan: ShipmentPlan): ShipmentBom {
  const lines = new Map<string, BomLine>();
  let plywoodM2 = 0;
  let lumberM = 0;
  let screws = 0;
  const areas = new Map<number, number>();
  let sheetBasis: SheetsNeeded | null = null;
  for (const t of plan.crates) {
    const d = t.result.design;
    if (!d) continue;
    sheetBasis ??= d.sheets;
    for (const l of d.sheets.lines) areas.set(l.thicknessMm, (areas.get(l.thicknessMm) ?? 0) + l.areaM2 * t.count);
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
  const all = tellApart([...lines.values()]);
  const firstSeen = new Map<string, number>();
  all.forEach((l, i) => firstSeen.set(`${l.assembly}|${l.name}`, firstSeen.get(`${l.assembly}|${l.name}`) ?? i));
  const order = (l: BomLine) => firstSeen.get(`${l.assembly}|${l.name}`)!;
  if (plan.crates.length > 1) all.sort((x, y) => order(x) - order(y));
  const sheets = sheetBasis ? sheetsFromAreas(areas, sheetBasis.sheetMm, sheetBasis.allowance) : sheetsFromAreas(areas, { width: 1220, length: 2440 });
  return { lines: all, plywoodM2, lumberM, sheets, screws };
}

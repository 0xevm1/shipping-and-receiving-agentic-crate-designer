import { msg, parts, type Message } from "./message";
import { evenSplit, planTotal, type QuantitySweep, type TotalPlan } from "./sweep";

/**
 * Why a total-quantity plan (`planTotal`, spec §7.16) splits the parts the way it does, in plain
 * words for the shared job section, the Overview and the API: the plan's own cost per part, then
 * its neighbours, one crate fewer and one crate more, each either failing a hard check (with the
 * check's own text) or costing more per part. Pure; the numbers come from the sweep's curve, so it
 * reads the same in the browser and on the server.
 *
 * Kept apart from the per-crate recommendation's rationale (`recommend` in sweep.ts): this one
 * explains the crate count for a total, that one the quantity per crate.
 */

/** Whole cents per part, as `planTotal` compares them. */
const cents = (usd: number) => Math.round(usd * 100);
const usd = (v: number) => `$${v.toFixed(2)}`;

/** "1 × 40", "2 × 20", "1 × 14 + 2 × 13": crates × parts each, fuller crates first. */
export function splitText(split: readonly { quantity: number; count: number }[]): string {
  return split.map((t) => `${t.count} × ${t.quantity}`).join(" + ");
}

/** How `total` parts in `crates` crates would fare on `sweep`'s curve. */
export type SplitOutcome =
  { ok: true; crates: number; text: string; scoreUsdPerPart: number } | { ok: false; crates: number; text: string; reason: Message | null; overMax: boolean };

/** The even split of `total` over `crates` crates, scored like `planTotal` scores it. */
export function splitOutcome(sweep: QuantitySweep, total: number, crates: number): SplitOutcome {
  const split = evenSplit(total, crates);
  const text = cratesText(crates, split);
  const tooBig = split.find((t) => t.quantity > sweep.maxQuantity);
  if (tooBig) return { ok: false, crates, text, reason: null, overMax: true };
  const failing = split.map((t) => sweep.curve[t.quantity - 1]).find((p) => !p?.ok);
  if (failing) return { ok: false, crates, text, reason: failing.reason, overMax: false };
  const cost = split.reduce((s, t) => {
    const c = sweep.curve[t.quantity - 1].crate!;
    return s + t.count * (c.crateCostUsd + (c.freightUsd ?? 0));
  }, 0);
  return { ok: true, crates, text, scoreUsdPerPart: cost / total };
}

/** "2 crates × 20", "3 crates (1 × 14 + 2 × 13)", "1 crate of 40". */
function cratesText(crates: number, split: readonly { quantity: number; count: number }[]): string {
  if (crates === 1) return `1 crate of ${split[0].quantity}`;
  if (split.length === 1) return `${crates} crates × ${split[0].quantity}`;
  return `${crates} crates (${splitText(split)})`;
}

/** A plan in words: "2 crates × 20", "3 crates (1 × 14 + 2 × 13)", "1 crate of 40". */
export const planText = (plan: { crates: number; types: readonly { quantity: number; count: number }[] }): string => cratesText(plan.crates, plan.types);

/**
 * One to three sentences on why `total` parts ship as `plan` (by default `planTotal(sweep,
 * total)`): "40 parts ship as 2 crates × 20 at $20.51 a part in crate cost. 1 crate of 40 would
 * fail a hard check: Gross 1,159 kg is over the 1,000 kg per-crate limit. 3 crates (1 × 14 +
 * 2 × 13) would cost $25.89 a part." Without a plan, why there is none.
 */
export function explainTotalPlan(sweep: QuantitySweep, total: number, plan: TotalPlan | null = planTotal(sweep, total)): Message {
  const n = Math.floor(total);
  if (sweep.problem) return msg`No crate can be designed for this part: ${sweep.problem.title}`;
  if (!plan) {
    const one = sweep.curve[0];
    if (!(n >= 1)) return parts("Give a total of at least one part.");
    if (one && !one.ok) return msg`${n} parts can't be planned: one part alone fails a hard check. ${one.reason ?? ""}`;
    return parts(`${n} parts can't be split evenly into crates that pass every check.`);
  }
  const per = sweep.basis === "crate-only" ? " in crate cost" : " in crate and freight cost";
  const head = msg`${n} parts ship as ${planText(plan)} at ${usd(plan.scoreUsdPerPart)} a part${per}.`;
  const lines: Message[] = [head];

  const fewer = plan.crates - 1;
  if (fewer >= 1) {
    const f = splitOutcome(sweep, n, fewer);
    if (f.ok) lines.push(parts(` ${f.text} would cost ${usd(f.scoreUsdPerPart)} a part.`));
    else if (f.overMax) lines.push(parts(` ${f.text} would need more than the ${sweep.maxQuantity} parts a crate the sweep tries.`));
    else lines.push(msg` ${f.text} would fail a hard check: ${f.reason ?? "a crate is over a limit."}`);
  }
  const more = plan.crates + 1;
  if (more <= n) {
    const m = splitOutcome(sweep, n, more);
    if (m.ok) {
      const same = cents(m.scoreUsdPerPart) === cents(plan.scoreUsdPerPart);
      lines.push(
        same ? parts(` ${m.text} would cost the same per part; fewer crates win a tie.`) : parts(` ${m.text} would cost ${usd(m.scoreUsdPerPart)} a part.`),
      );
    } else if (!m.overMax) lines.push(msg` ${m.text} would fail a hard check: ${m.reason ?? "a crate is over a limit."}`);
  }
  return parts(...lines);
}

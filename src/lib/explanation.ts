import type { ExplanationSectionId, RecommendationExplanation } from "@/domain/explainRecommendation";
import { usdCents } from "./format";
import { renderMessage } from "./message";
import type { Units } from "./units";

/**
 * "Why this crate?" (spec §7.16 "Explaining the recommendation") as text in the selected units:
 * the one rendering the Rules tab, the crate spec PDF, the comparison PDF and the API share, so
 * their wording never drifts apart. Pure.
 */
export interface ExplanationText {
  quantity: number;
  headline: string;
  sections: { id: ExplanationSectionId; title: string; lines: string[] }[];
  /** The recommended crate's cost, wood to score: "$75.16", or "Not priced". */
  costLines: { label: string; detail: string | null; value: string; total: boolean }[];
  /** The shortlist, best first: "$19.40", and "+$0.17" against the pick ("pick" for the pick). */
  ranking: { quantity: number; perPart: string; vsPick: string; picked: boolean }[];
}

/** A signed difference in cost per part: "+$0.17", "−$0.02", or "same" when it rounds to $0.00. */
export function perPartDelta(v: number): string {
  const c = Math.round(v * 100);
  if (c === 0) return "same";
  return `${c > 0 ? "+" : "−"}${usdCents(Math.abs(c) / 100)}`;
}

export function explanationText(e: RecommendationExplanation, u: Units): ExplanationText {
  return {
    quantity: e.quantity,
    headline: renderMessage(e.headline, u),
    sections: e.sections.map((s) => ({ id: s.id, title: s.title, lines: s.lines.map((l) => renderMessage(l, u)) })),
    costLines: e.costLines.map((l) => ({ label: l.label, detail: l.detail, value: l.usd === null ? "Not priced" : usdCents(l.usd), total: l.total })),
    ranking: e.ranking.map((r) => ({
      quantity: r.quantity,
      perPart: usdCents(r.scoreUsdPerPart),
      vsPick: r.picked ? "pick" : perPartDelta(r.vsPickUsdPerPart),
      picked: r.picked,
    })),
  };
}

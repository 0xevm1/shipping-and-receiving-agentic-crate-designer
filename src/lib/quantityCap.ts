import { MAX_TOTAL_QUANTITY } from "@/lib/api/designs";

/** What the Rules tab says when a typed quantity was over what one crate holds. */
interface QuantityCapNote {
  text: string;
  /** The total to put in Parts to ship; null when the typed number can't go there. */
  prefill: number | null;
  /** The label of the control that goes to Parts to ship; null when it isn't there to go to. */
  action: string | null;
}

const n = (v: number) => v.toLocaleString("en-US");

/**
 * The note for a typed quantity `typed` above `crateMax`: says so plainly and points at Parts to
 * ship on the Overview. `canPoint` is false when that field isn't shown (it needs the shared job),
 * and then the note says what to do instead rather than point at nothing.
 */
export function quantityCapNote(typed: number, crateMax: number, canPoint: boolean): QuantityCapNote {
  const head = `One crate holds at most ${n(crateMax)}.`;
  const total = Math.round(typed);
  const action = canPoint ? "Go to Parts to ship" : null;
  if (total > MAX_TOTAL_QUANTITY) {
    return {
      text: canPoint
        ? `${head} Parts to ship on the Overview takes up to ${n(MAX_TOTAL_QUANTITY)}.`
        : `${head} Parts to ship takes up to ${n(MAX_TOTAL_QUANTITY)}; it appears on the Overview once the shared job is connected.`,
      prefill: null,
      action,
    };
  }
  return {
    text: canPoint
      ? `${head} To ship ${n(total)}, use Parts to ship on the Overview.`
      : `${head} To ship ${n(total)}, use Parts to ship on the Overview; it appears there once the shared job is connected.`,
    prefill: total,
    action,
  };
}

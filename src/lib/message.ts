import type { Message, Quantity } from "@/domain/message";
import { fraction, length, weight, type Units } from "./units";

/**
 * Renders a check message for the selected units (#62). The domain keeps lengths and masses
 * as typed quantities in mm and kg; this is the one place they become text.
 *
 * Metric reads as it always did ("2,489 mm", "1,240 kg"). Imperial: overall sizes in inches
 * to one decimal ("98.0 in"), shop measurements to the nearest 1/16" ("3 1/2″"), masses by
 * the app's one mass rule (`weight`).
 */
export function renderQuantity(q: Quantity, u: Units): string {
  if (q.kind === "mass") return weight(q.kg, u, true);
  if (u === "metric") return `${Math.round(q.mm).toLocaleString("en-US")} mm`;
  return q.fine ? fraction(q.mm) : `${Number(length(q.mm, u)).toLocaleString("en-US", { minimumFractionDigits: 1 })} in`;
}

export function renderMessage(m: Message, u: Units): string {
  return m.map((p) => (typeof p === "string" ? p : renderQuantity(p, u))).join("");
}

/** The metric text of a message: what the checks read as before #62, and what tests pin. */
export const metricText = (m: Message): string => renderMessage(m, "metric");

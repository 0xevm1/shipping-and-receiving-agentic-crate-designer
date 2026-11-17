import type { SettingsAdjustment } from "@/domain/schema";

/**
 * A short, polite note for a typed rule value that `normalizeSettings` did not take as given:
 * "Quantity is 1–200; set to 200", or "Not a number; kept 50 mm".
 */
export function clampNote(adj: SettingsAdjustment, label: string, fmt: (v: number) => string = String): string {
  if (adj.kind === "rejected") return `Not a number; kept ${fmt(adj.value)}`;
  if (adj.kind === "rounded") return `${label} is a whole number; set to ${fmt(adj.value)}`;
  return `${label} is ${fmt(adj.min)}–${fmt(adj.max)}; set to ${fmt(adj.value)}`;
}

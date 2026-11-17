import type { Message } from "./message";

/**
 * The rule results shown on the Checks tab. Each id belongs to the module that produces it, so a
 * new rule adds an id to one group and nowhere else.
 */

/** Produced by `crateChecks.ts`. */
type CrateCheckId = "door" | "oversize" | "blocking" | "stack" | "stable" | "base-rating" | "lid" | "utilization" | "cardboard";

/** Produced by `handling.ts`. */
export type HandlingCheckId = "cog-offset" | "cog-tip" | "forklift" | "pallet-jack";

/** Produced by `shipment.ts`, only for a crate in a shipment plan. */
type ShipmentCheckId = "crate-limit";

type CheckId = CrateCheckId | HandlingCheckId | ShipmentCheckId;

export interface Check<Id extends CheckId = CheckId> {
  id: Id;
  /** `ok` = rule passed, `caution` = needs attention, `info` = worth knowing. */
  level: "ok" | "caution" | "info";
  title: string;
  /** The sentence with its lengths and masses as data; render it with `renderMessage` (src/lib/message.ts). */
  detail: Message;
}

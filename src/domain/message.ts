/**
 * Check messages with their numbers kept as data (#62, spec §7.16).
 *
 * The domain is unit-free (mm and kg). A check used to bake "2,489 mm" into its sentence, which
 * the units toggle then could not reach. A `Message` is the sentence as parts: plain text and
 * typed quantities. `renderMessage` in `src/lib/message.ts` turns it into a string for a
 * `Units` value at the edge (Checks tab, print spec, PDF, export text). Pure.
 */

/** A length in mm. `fine` marks a shop measurement (a gap, a floor, a tine) shown in fractional inches. */
export interface LengthQty {
  readonly kind: "length";
  readonly mm: number;
  readonly fine?: boolean;
}

/** A mass in kg. */
export interface MassQty {
  readonly kind: "mass";
  readonly kg: number;
}

export type Quantity = LengthQty | MassQty;
export type MessagePart = string | Quantity;
export type Message = readonly MessagePart[];

/** An overall size in mm (a door, a crate side, a trailer): inches to one decimal in imperial. */
export const mm = (v: number): LengthQty => ({ kind: "length", mm: v });
/** A shop measurement in mm (a gap, clearance, floor or fork width): nearest 1/16" in imperial. */
export const shopMm = (v: number): LengthQty => ({ kind: "length", mm: v, fine: true });
export const kg = (v: number): MassQty => ({ kind: "mass", kg: v });

type Hole = string | number | Quantity | Message;

const isQuantity = (v: Hole): v is Quantity => typeof v === "object" && !Array.isArray(v);

/** Appends `part`, merging neighbouring strings so equal messages compare equal. */
function push(out: MessagePart[], part: MessagePart): void {
  if (part === "") return;
  const last = out.length - 1;
  if (typeof part === "string" && last >= 0 && typeof out[last] === "string") out[last] += part;
  else out.push(part);
}

/** Builds a message from strings, numbers (as plain text), quantities and nested messages. */
export function parts(...items: readonly Hole[]): Message {
  const out: MessagePart[] = [];
  for (const item of items) {
    if (typeof item === "string") push(out, item);
    else if (typeof item === "number") push(out, String(item));
    else if (isQuantity(item)) push(out, item);
    else for (const p of item) push(out, p);
  }
  return out;
}

/** Tagged template: msg`Within the ${mm(2489)} door.` */
export function msg(strings: TemplateStringsArray, ...holes: readonly Hole[]): Message {
  const items: Hole[] = [];
  strings.forEach((s, i) => {
    items.push(s);
    if (i < holes.length) items.push(holes[i]);
  });
  return parts(...items);
}

/** `items` separated by `sep`. */
export function joinMessages(items: readonly Message[], sep: string): Message {
  return parts(...items.flatMap((m, i) => (i ? [sep, m] : [m])));
}

/** "a × b × c" of lengths. */
export function dimsMessage(values: readonly number[], make: (v: number) => LengthQty = mm): Message {
  return joinMessages(
    values.map((v) => [make(v)]),
    " × ",
  );
}

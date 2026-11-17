/**
 * Turns a design diff (`diffDesigns`, #39) into what the screen says: "Gross 16 → 20 kg",
 * or "No change to the crate". A change that rounds to the same text in the selected units
 * is dropped, so the note never claims "Gross 16 → 16 kg" and the Overview doesn't flash
 * a number that looks the same.
 */
import type { DesignChange, DesignField } from "@/domain/diff";
import { plywoodText, sectionText } from "./lumber";
import { dims, lengthUnit, weight, type Units } from "./units";

export const NO_CHANGE = "No change to the crate";

const LABELS: Record<DesignField, string> = {
  gross: "Gross",
  outside: "Outside",
  panel: "Wall plywood",
  floor: "Floor",
  skid: "Skids",
  skidCount: "Skid count",
  grid: "Layout",
  payload: "Parts",
  tare: "Empty crate",
};

export interface ChangeText {
  field: DesignField;
  label: string;
  from: string;
  to: string;
  /** Unit after the new value, or "" when the values carry their own (inch fractions). */
  unit: string;
}

const num = (v: number | readonly number[]) => (typeof v === "number" ? v : v[0]);
const list = (v: number | readonly number[]) => (typeof v === "number" ? [v] : v);

function values(c: DesignChange, u: Units): { from: string; to: string; unit: string } {
  const imperial = u === "imperial";
  switch (c.field) {
    case "gross":
    case "payload":
    case "tare": {
      // weight() gives "16 kg"; split off the unit so it is said once.
      const [from, unit] = weight(num(c.from), u).split(" ");
      return { from, to: weight(num(c.to), u).split(" ")[0], unit };
    }
    case "outside":
      return { from: dims(list(c.from), u), to: dims(list(c.to), u), unit: lengthUnit(u) };
    case "panel":
    case "floor":
    case "skid": {
      // Imperial uses shop names (#15): "1/2″ → 5/8″" plywood, "4x4 → 4x6" skids.
      const shop = (v: readonly number[]) => (v.length === 2 ? sectionText(v[0], v[1]) : plywoodText(v[0]));
      const f = (v: number | readonly number[]) => (imperial ? shop(list(v)) : list(v).join(" × "));
      return { from: f(c.from), to: f(c.to), unit: imperial ? "" : "mm" };
    }
    case "skidCount":
      return { from: String(c.from), to: String(c.to), unit: "" };
    case "grid":
      return { from: list(c.from).join(" × "), to: list(c.to).join(" × "), unit: "" };
  }
}

/** The changes that look different in `units`, as text. */
export function visibleChanges(changes: readonly DesignChange[], u: Units): ChangeText[] {
  return changes
    .map((c) => ({ field: c.field, label: LABELS[c.field], ...values(c, u) }))
    .filter((t) => t.from !== t.to);
}

/** "Gross 16 → 20 kg", up to `max` changes, then "+N more"; or "No change to the crate". */
export function changeNote(changes: readonly DesignChange[], u: Units, max = 2): string {
  const shown = visibleChanges(changes, u);
  if (shown.length === 0) return NO_CHANGE;
  const parts = shown.slice(0, max).map((t, i) => {
    const label = i === 0 ? t.label : t.label.toLowerCase();
    return `${label} ${t.from} → ${t.to}${t.unit ? ` ${t.unit}` : ""}`;
  });
  const more = shown.length - max;
  return parts.join(", ") + (more > 0 ? `, +${more} more` : "");
}

const volume = (v: number | readonly number[]) => list(v).reduce((a, b) => a * b, 1);

/**
 * The short note the screen shows (#62): the outcome, not every before → after.
 *
 *   outside size changed   "Crate grew: 2176 × 936 × 831 mm, 878 kg" (or "shrank", or "resized"
 *                           when the length, width and height moved in opposite directions)
 *   gross / parts only     "Crate heavier: 20 kg" (or "lighter")
 *   one other change       its own detail, which is already short: "Wall plywood 1/2″ → 5/8″"
 *   several other changes  "Crate changed: wall plywood, floor, +1 more"
 *   nothing visible        "No change to the crate"
 *
 * The weight is the new gross, shown only when the gross moved. `changeNote` has the full
 * detail; the note's `title` and screen-reader text carry it.
 */
export function changeSummary(changes: readonly DesignChange[], u: Units): string {
  const shown = visibleChanges(changes, u);
  if (shown.length === 0) return NO_CHANGE;
  const by = (f: DesignField) => changes.find((c) => c.field === f);
  const text = (f: DesignField) => shown.find((t) => t.field === f);

  const gross = text("gross");
  const grossTail = gross ? `, ${weight(num(by("gross")!.to), u)}` : "";

  const outside = text("outside");
  if (outside) {
    const c = by("outside")!;
    const [fromL, toL] = [list(c.from), list(c.to)];
    const up = toL.some((v, i) => v > fromL[i]);
    const down = toL.some((v, i) => v < fromL[i]);
    // Mixed moves (longer but lower) are judged by the volume they enclose.
    const verb = up && down ? (volume(c.to) >= volume(c.from) ? "grew" : "shrank") : up ? "grew" : "shrank";
    return `Crate ${verb}: ${outside.to} ${outside.unit}${grossTail}`;
  }
  if (shown.length === 1) return changeNote(changes, u);
  if (gross && shown.every((t) => t.field === "gross" || t.field === "payload" || t.field === "tare")) {
    const c = by("gross")!;
    return `Crate ${num(c.to) > num(c.from) ? "heavier" : "lighter"}: ${weight(num(c.to), u)}`;
  }
  const labels = shown.slice(0, 2).map((t) => t.label.toLowerCase());
  const more = shown.length - 2;
  return `Crate changed: ${labels.join(", ")}${more > 0 ? `, +${more} more` : ""}`;
}

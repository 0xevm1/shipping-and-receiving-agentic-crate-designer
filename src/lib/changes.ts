/**
 * Turns a design diff (`diffDesigns`, #39) into what the screen says: "Gross 16 → 20 kg",
 * or "No change to the crate". A change that rounds to the same text in the selected units
 * is dropped, so the note never claims "Gross 16 → 16 kg" and the Overview doesn't flash
 * a number that looks the same.
 */
import type { DesignChange, DesignField } from "@/domain/diff";
import { plywoodText, sectionText } from "./lumber";
import { dims, lengthUnit, weightWhole, type Units } from "./units";

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
      // weightWhole() gives "16 kg"; split off the unit so it is said once.
      const [from, unit] = weightWhole(num(c.from), u).split(" ");
      return { from, to: weightWhole(num(c.to), u).split(" ")[0], unit };
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

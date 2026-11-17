import type { BomLine } from "@/domain/crate";
import type { Layout } from "@/domain/packing";
import { lumberText, plywoodText } from "./lumber";
import { cut, lengthUnit, type Units } from "./units";

/**
 * Metric: "19 × 89 lumber", "12 mm plywood". Imperial uses shop names: "1x4",
 * "1/2″ plywood", and "1 15/16″ × 3 1/2″ from 4x4" for blocking cut to the gap.
 */
export function stockText(l: Pick<BomLine, "material" | "kind" | "stockMm">, u: Units): string {
  if (l.material === "plywood") return u === "imperial" ? `${plywoodText(l.stockMm[0])} plywood` : `${l.stockMm[0]} mm plywood`;
  return u === "imperial" ? lumberText(l.stockMm, l.kind) : `${l.stockMm.join(" × ")} lumber`;
}

export function cutText(l: BomLine, u: Units): string {
  return l.cutMm.map((v) => cut(v, u)).join(" × ");
}

/** "2 × 2, one layer", "4 in a row", "1 per layer, 2 layers". */
export function describeLayout(l: Layout): string {
  const [nx, ny, nz] = l.counts;
  if (l.slots.length === 1) return "Single part";
  if (nz > 1) return `${nx * ny === 1 ? "1" : `${nx} × ${ny}`} per layer, ${nz} layers`;
  return ny === 1 ? `${nx} in a row` : `${nx} × ${ny}, one layer`;
}

export function layoutName(l: Layout): string {
  return describeLayout(l) + (l.orientation.id === "as-modeled" ? "" : `, ${l.orientation.label.toLowerCase()}`);
}

/**
 * The calendar date of `iso` as "2026-11-16" in `timeZone` (an IANA name such as "Europe/Paris"),
 * or in this device's own zone when none is given. Documents carry the date the person saw on
 * their clock, not the UTC one. The zone is a parameter so the function stays testable.
 */
export function documentDate(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  // en-CA writes year-month-day.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** "Parts are not restrained" read mid-sentence: "parts are not restrained". Acronyms and numbers keep their case. */
const sentenceCase = (title: string) => (/^[A-Z][a-z]/.test(title) ? title[0].toLowerCase() + title.slice(1) : title);

/**
 * The one-line verdict under the Overview's outside size for these caution titles (empty when
 * there are none): "1 caution: parts are not restrained", "2 cautions: a and b",
 * "3 cautions: a and 2 more".
 */
export function cautionVerdict(titles: readonly string[]): string {
  const [first, second] = titles.map(sentenceCase);
  if (!first) return "";
  if (titles.length === 1) return `1 caution: ${first}`;
  const rest = titles.length === 2 ? second : `${titles.length - 1} more`;
  return `${titles.length} cautions: ${first} and ${rest}`;
}

/** A saved-on date for lists, in this device's locale ("Nov 16, 2026"); the raw text if it isn't a date. */
export function savedDateText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Whole dollars with thousands separators: "$1,186". */
export function usd(v: number): string {
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

/** Dollars and cents with thousands separators, for a cost per part: "$5.47", "$1,186.20". */
export function usdCents(v: number): string {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A signed dollar difference: "+$12", "−$5", or "same cost" when it rounds to $0. */
export function usdDelta(v: number): string {
  const r = Math.round(v);
  if (r === 0) return "same cost";
  return `${r > 0 ? "+" : "−"}${usd(Math.abs(r))}`;
}

/** Build time to the minute: "2 h 43 m", "45 m". */
export function hoursText(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h ${m} m` : `${m} m`;
}

/** Elapsed time to the second: "45 s", "1 m 12 s", "1 h 3 m". */
export function elapsedText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} m ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} m`;
}

const KG_M3_PER_LB_FT3 = 16.0185;

/** Freight density: "26.7 lb/ft³", or "428 kg/m³" in metric. */
export function densityText(lbFt3: number, u: Units): string {
  return u === "imperial" ? `${lbFt3.toFixed(1)} lb/ft³` : `${Math.round(lbFt3 * KG_M3_PER_LB_FT3)} kg/m³`;
}

/** A signed density difference in the display units, or "" when it rounds to nothing. */
export function densityDelta(lbFt3: number, u: Units): string {
  const v = u === "imperial" ? Math.round(lbFt3 * 10) / 10 : Math.round(lbFt3 * KG_M3_PER_LB_FT3);
  if (v === 0) return "";
  const text = u === "imperial" ? `${Math.abs(v).toFixed(1)} lb/ft³` : `${Math.abs(v)} kg/m³`;
  return `${v > 0 ? "+" : "−"}${text}`;
}

/**
 * The header's model note after the measured size. `matches` is whether the file's size agrees
 * with the catalog (null when there is nothing to compare: a part without catalog data).
 */
export function modelNote(matches: boolean | null, readAsMm: boolean | undefined): string {
  if (matches === true) return "model matches catalog";
  if (matches === false) return "model does not match catalog";
  return readAsMm ? "file read as millimetres" : "size measured from the file";
}

/** "1 caution, see Checks": what the Export pill says when the design has cautions; "" for none. */
export function cautionNote(count: number): string {
  return count > 0 ? `${count} ${count === 1 ? "caution" : "cautions"}, see Checks` : "";
}

/**
 * The second line of a board's hover tooltip: the stock, the cut and how many are in the crate,
 * e.g. `1/2″ plywood, cut 35 7/16″ × 25 1/4″. 2 in this crate`. Imperial cuts carry their own inch
 * mark; metric cuts are bare numbers, so they get the unit once at the end.
 */
export function boardTooltipDetail(line: BomLine, units: Units): string {
  const unit = units === "metric" ? ` ${lengthUnit(units)}` : "";
  return `${stockText(line, units)}, cut ${cutText(line, units)}${unit}. ${line.qty} in this crate`;
}

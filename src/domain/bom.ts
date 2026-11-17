import { SCREWS_PER_CRADLE } from "./cradles";
import { sortDesc, type Assembly, type Member, type MemberKind, type WoodMaterial } from "./members";
import type { Vec3 } from "./schema";
import { DEFAULT_STANDARDS, type ShopStandards } from "./standards";

/** The cut list and the screw schedule, both read off the finished boards. */

export interface BomLine {
  /** Unique per line; equals `bomKey` on its members. */
  key: string;
  assembly: Assembly;
  label: string;
  kind: MemberKind;
  material: WoodMaterial;
  /** e.g. "19 × 89" lumber section or "12 mm" plywood. */
  stock: string;
  /** Cut size: length for lumber, L × W for plywood. */
  cut: string;
  /** Stock in mm: [thickness] for plywood, [thickness, width] for lumber. */
  stockMm: number[];
  /** Cut in mm: [length] for lumber, [length, width] for plywood. */
  cutMm: number[];
  qty: number;
  /** Cradles only: notches cut in each piece, each an extra saw cut. */
  notches?: number;
}

/** Groups members into cut-list lines by assembly, piece name, stock and cut, and links each member to its line. */
export function buildBom(members: Member[]): BomLine[] {
  const lines = new Map<string, BomLine>();
  for (const m of members) {
    const s = sortDesc(m.size.map((v) => Math.round(v)));
    const plywood = m.material === "plywood";
    const stockMm = plywood ? [s[2]] : [s[2], s[1]];
    const cutMm = plywood ? [s[0], s[1]] : [s[0]];
    const stock = plywood ? `${s[2]} mm` : `${s[2]} × ${s[1]}`;
    const cut = cutMm.join(" × ");
    // Cradles with a different number of notches are different pieces.
    const notches = m.cradle?.notches.length;
    const key = `${m.assembly}|${m.label}|${stock}|${cut}${notches ? `|${notches} notches` : ""}`;
    m.bomKey = key;
    const line = lines.get(key);
    if (line) line.qty++;
    else {
      const { assembly, label, kind, material } = m;
      lines.set(key, { key, assembly, label, kind, material, stock, cut, stockMm, cutMm, qty: 1, ...(notches && { notches }) });
    }
  }
  return [...lines.values()];
}

/** One line of the fastener schedule: where the screws go, how they are spaced, how many. */
export interface ScrewLine {
  id:
    | "skids"
    | "joists"
    | "side-cleats"
    | "end-cleats"
    | "walls-to-floor"
    | "corners"
    | "bearers"
    | "cradles"
    | "stacking-cradles"
    | "blocking"
    | "lid-cleats"
    | "lid-to-walls";
  /** The sub-assembly the screws are driven in, for the build order. */
  assembly: Assembly;
  /** "Floor to skids". */
  title: string;
  /** Spacing rule; the spacing in mm (null for a fixed count per piece). */
  everyMm: number | null;
  /** "along each skid, plus 1", "per bearer". */
  rule: string;
  qty: number;
}

const line = (id: ScrewLine["id"], assembly: Assembly, title: string, everyMm: number | null, rule: string, qty: number): ScrewLine => ({
  id,
  assembly,
  title,
  everyMm,
  rule,
  qty,
});

/** Screws per bearer and per blocking post. */
const SCREWS_PER_BLOCK = 2;
/** Screws where a floor joist crosses a skid. */
const SCREWS_PER_JOIST_CROSSING = 2;
/** Wall corners, each screwed up its height. */
const CORNERS = 4;

/**
 * The screw estimate line by line (spec §7.6), at the standard spacings (`rates.screwSpacingMm`;
 * defaults: cleats every 150 mm, panel joints every 200 mm, skids every 300 mm), plus 2 per
 * block or bearer and 4 per cradle. `CrateDesign.screws` is the sum. Lines with no screws are left out.
 */
export function screwSchedule(members: Member[], interior: Vec3, standards: ShopStandards = DEFAULT_STANDARDS): ScrewLine[] {
  const [L, W, H] = interior;
  const every = standards.rates.screwSpacingMm;
  const along = (match: (m: Member) => boolean, spacing: number) =>
    members.filter(match).reduce((n, m) => n + Math.ceil(Math.max(...m.size) / spacing) + 1, 0);
  const count = (kind: MemberKind) => members.filter((m) => m.kind === kind).length;
  const cradles = (stacking: boolean) => members.filter((m) => m.kind === "cradle" && (m.variant === "stacking-cradle") === stacking).length;
  const joint = Math.ceil((2 * (L + W)) / every.panelJoint);
  const cleatOf = (a: Assembly) => (m: Member) => (m.kind === "cleat" || m.kind === "lid-cleat") && m.assembly === a;
  const joists = count("joist");
  const joistCrossings = joists * count("skid") * SCREWS_PER_JOIST_CROSSING;
  const crossingRule = `${SCREWS_PER_JOIST_CROSSING} where each joist crosses a skid`;
  const alongPlusOne = "along each cleat, plus 1";
  const eachEnd = "2 at each end of each cradle"; // SCREWS_PER_CRADLE is 4: two at each end
  const lines: ScrewLine[] = [
    joists > 0
      ? line("skids", "base", "Floor joists to skids", null, crossingRule, joistCrossings)
      : line("skids", "base", "Floor to skids", every.skid, "along each skid, plus 1", along((m) => m.kind === "skid", every.skid)),
    line("joists", "base", "Floor to joists", every.skid, "along each joist, plus 1", along((m) => m.kind === "joist", every.skid)),
    line("side-cleats", "sides", "Side wall cleats to panels", every.cleat, alongPlusOne, along(cleatOf("sides"), every.cleat)),
    line("end-cleats", "ends", "End wall cleats to panels", every.cleat, alongPlusOne, along(cleatOf("ends"), every.cleat)),
    line("walls-to-floor", "sides", "Walls to floor", every.panelJoint, "around the base", joint),
    line("corners", "sides", "Wall corners", every.panelJoint, `up each of the ${CORNERS} corners`, Math.ceil(H / every.panelJoint) * CORNERS),
    line("bearers", "inside", "Bearers to floor", null, `${SCREWS_PER_BLOCK} per bearer`, count("bearer") * SCREWS_PER_BLOCK),
    line("cradles", "inside", "Cradles to floor", null, eachEnd, cradles(false) * SCREWS_PER_CRADLE),
    line("stacking-cradles", "inside", "Stacking cradles through the side walls", null, eachEnd, cradles(true) * SCREWS_PER_CRADLE),
    line("blocking", "inside", cradles(false) ? "End stops" : "Blocking posts", null, `${SCREWS_PER_BLOCK} per post`, count("blocking") * SCREWS_PER_BLOCK),
    line("lid-cleats", "lid", "Lid cleats to lid panel", every.cleat, alongPlusOne, along(cleatOf("lid"), every.cleat)),
    line("lid-to-walls", "lid", "Lid to walls", every.panelJoint, "around the top", joint),
  ];
  return lines.filter((l) => l.qty > 0);
}

/** Total wood screws: the sum of `screwSchedule`. */
export function screwCount(members: Member[], interior: Vec3, standards: ShopStandards): number {
  return screwSchedule(members, interior, standards).reduce((n, l) => n + l.qty, 0);
}

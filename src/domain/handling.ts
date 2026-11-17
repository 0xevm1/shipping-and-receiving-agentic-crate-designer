import type { Check, HandlingCheckId } from "./check";
import { entryDirections, type ForkDirection, type ForkEntry } from "./forkEntry";
import { cogBasisOf, cogOffsetOf, type CogBasis, type PartCog } from "./cog";
import { memberKg } from "./materials";
import { memberBounds, type Member } from "./members";
import { joinMessages, kg, mm, msg, parts, shopMm, type Message } from "./message";
import { ORIENTATIONS, rotatedOffset } from "./orientations";
import type { Layout } from "./packing";
import type { Vec3 } from "./schema";
import { DEFAULT_STANDARDS, type ShopStandards } from "./standards";

/**
 * Centre of gravity, forklift and pallet-jack handling (spec §7.14). Pure: it reads the
 * finished crate's members and part placements and never changes the construction, so it
 * follows whatever skids, bearers or blocking `designCrate` builds.
 *
 * Coordinates are the crate-interior frame of `Member` (spec §4): origin at the interior min
 * corner on top of the floor, Z up, X along the length. The shop standard `handling.forkEntry`
 * says which directions forks must enter from (#112): along X from the ends, along Y from the
 * sides, or both. Each is checked on its own against the openings between the boards that stand
 * on the ground (the skids, or the lifting blocks under them). The ground is the bottom of those
 * boards, at negative Z.
 */

/** What the part placements need of a layout. The orientation turns the part's centre of gravity; without one the part is as modelled. */
type HandlingLayout = Pick<Layout, "slots" | "cellSize"> & Partial<Pick<Layout, "orientation">>;

/** A point mass. */
interface MassPoint {
  at: Vec3;
  kg: number;
}

/**
 * The space between two neighbouring boards standing on the ground (skids, or lifting blocks),
 * open at both ends of the way the forks travel.
 */
export interface Opening {
  /** Lower edge across the way the forks travel (Y for the ends, X for the sides), crate-interior mm. */
  y: number;
  /** Clear width between the two. */
  width: number;
  /** Clear height from the ground to the lowest board above the opening (the floor, or a skid over a lifting block). */
  clearMm: number;
}

type Device = "forklift" | "pallet-jack";

interface DeviceFit {
  device: Device;
  fits: boolean;
  /** Why not, when it doesn't: the height under the floor, or the width between the skids. */
  problem: "height" | "width" | null;
  /** Tallest opening, mm. */
  clearMm: number;
  needClearMm: number;
  /** Where the two tines go when it fits: their centre lines, crate-interior Y. */
  tines: [number, number] | null;
}

/** Handling from one direction of fork entry: the openings the forks enter, and each device against them. */
interface EntryHandling {
  direction: ForkDirection;
  /** Openings along the axis across the entry, lowest first (−Y first for the ends, −X first for the sides). */
  openings: Opening[];
  devices: DeviceFit[];
}

export interface Handling {
  /** Combined centre of gravity of the crate and the parts, crate-interior mm. */
  cogMm: Vec3;
  /** Where the part's own centre of gravity came from: supplied, estimated from the mesh, or assumed at the middle of its box (#110). */
  cogBasis: CogBasis;
  /** CoG minus the middle of the outside footprint, [X, Y] mm (+X toward the right end, +Y toward the back). */
  offsetMm: [number, number];
  /** Outside length and width the offset is judged against. */
  footprintMm: [number, number];
  /** Gross weight of the crate and its parts, kg (boards plus parts: the design's `grossKg`). */
  grossKg: number;
  /** CoG height above the ground (the bottom of the skids). */
  heightMm: number;
  /** Static tip angle in degrees: tilt about the nearest base edge at which the CoG passes over it. */
  tipAngleDeg: number;
  /** Which edge that is: an end (tipping along X) or a side (tipping along Y). */
  tipToward: "end" | "side";
  /** Ground Z (bottom of the skids), crate-interior mm. */
  groundZ: number;
  /** The shop standard's fork entry (`handling.forkEntry`) this was analysed for. */
  forkEntry: ForkEntry;
  /** One per direction the crate must be enterable from: the ends first, then the sides. */
  entries: EntryHandling[];
}

const centre = (m: Pick<Member, "min" | "size">): Vec3 => [m.min[0] + m.size[0] / 2, m.min[1] + m.size[1] / 2, m.min[2] + m.size[2] / 2];

/** Each board's mass at its centre: volume × the standard wood density (the tare model of spec §7.6). */
export function memberMasses(members: Member[], standards: ShopStandards = DEFAULT_STANDARDS): MassPoint[] {
  return members.map((m) => ({ at: centre(m), kg: memberKg(m, standards) }));
}

/**
 * Each part's mass at its own centre of gravity: the middle of its packed bounding box plus the
 * part's offset (`PartCog`) turned by the layout's orientation, so a lopsided part's weight moves
 * with the part. With no `cog` the centre is assumed to be the bounding-box centre.
 */
export function partMasses(layout: HandlingLayout, partKg: number, cog?: PartCog): MassPoint[] {
  const [a, b, c] = layout.cellSize;
  const [dx, dy, dz] = rotatedOffset(cogOffsetOf({ cog }), layout.orientation ?? ORIENTATIONS[0]);
  return layout.slots.map((s) => ({ at: [s.min[0] + a / 2 + dx, s.min[1] + b / 2 + dy, s.min[2] + c / 2 + dz], kg: partKg }));
}

/** Mass-weighted mean position. */
export function centreOfGravity(points: MassPoint[]): Vec3 {
  let kg = 0;
  const sum: Vec3 = [0, 0, 0];
  for (const p of points) {
    kg += p.kg;
    for (let i = 0; i < 3; i++) sum[i] += p.at[i] * p.kg;
  }
  return kg > 0 ? [sum[0] / kg, sum[1] / kg, sum[2] / kg] : [0, 0, 0];
}

/** The boards a crate stands on: its skids, and the lifting blocks under them when it has any. */
const isBearer = (m: Member) => m.kind === "skid" || m.kind === "lift-block";

/**
 * The openings forks travelling in `direction` (the ends: along X; the sides: along Y) can enter,
 * read from the members: the gaps, across that way, between the boards standing on the ground. The
 * clear height is from the ground to the lowest other board over the opening, so anything hung
 * under the floor counts, and so do the skids over a gap between lifting blocks.
 */
export function forkOpenings(members: Member[], direction: ForkDirection = "ends"): Opening[] {
  const axis = direction === "ends" ? 1 : 0;
  const bearers = members.filter(isBearer);
  if (!bearers.length) return [];
  const groundZ = Math.min(...bearers.map((b) => b.min[2]));
  const feet = bearers.filter((b) => b.min[2] <= groundZ + 0.5).sort((p, q) => p.min[axis] - q.min[axis]);
  if (feet.length < 2) return [];
  const others = members.filter((m) => !feet.includes(m));
  const out: Opening[] = [];
  let edge = feet[0].min[axis] + feet[0].size[axis];
  for (const f of feet.slice(1)) {
    const y0 = edge;
    const y1 = f.min[axis];
    edge = Math.max(edge, f.min[axis] + f.size[axis]);
    if (y1 - y0 <= 0.5) continue;
    const above = others.filter((m) => m.min[axis] < y1 && m.min[axis] + m.size[axis] > y0).map((m) => m.min[2]);
    out.push({ y: y0, width: y1 - y0, clearMm: (above.length ? Math.min(...above) : Infinity) - groundZ });
  }
  return out;
}

type DeviceStandard = ShopStandards["handling"]["forklift"];

/**
 * Whether two tines of `tineWidthMm` can go into the openings (both in one, or one in each) with
 * an outside spread in the device's range and the CoG between their centre lines, so the load
 * doesn't roll off. Returns the tine centre lines, or null.
 */
export function placeTines(openings: Opening[], cogY: number, d: DeviceStandard): [number, number] | null {
  const w = d.tineWidthMm;
  // Centre-to-centre distance allowed: spread minus one tine width; never overlapping.
  const dMin = Math.max(d.spreadMm.min - w, w);
  const dMax = d.spreadMm.max - w;
  for (let i = 0; i < openings.length; i++) {
    for (let j = i; j < openings.length; j++) {
      const a = openings[i];
      const b = openings[j];
      const pLo = a.y + w / 2;
      const pHi = Math.min(a.y + a.width - w / 2, cogY);
      const qLo = Math.max(b.y + w / 2, cogY);
      const qHi = b.y + b.width - w / 2;
      if (pLo > pHi || qLo > qHi) continue;
      const lo = Math.max(qLo - pHi, dMin);
      const hi = Math.min(qHi - pLo, dMax);
      if (lo > hi) continue;
      // The narrowest allowed spread, centred on the CoG as far as the openings allow.
      const p = Math.max(pLo, qLo - lo, Math.min(pHi, qHi - lo, cogY - lo / 2));
      return [p, p + lo];
    }
  }
  return null;
}

function fit(device: Device, openings: Opening[], cogY: number, d: DeviceStandard): DeviceFit {
  const clearMm = openings.length ? Math.max(...openings.map((o) => o.clearMm)) : 0;
  const tall = openings.filter((o) => o.clearMm >= d.minClearMm);
  const tines = tall.length ? placeTines(tall, cogY, d) : null;
  return {
    device,
    fits: tines !== null,
    problem: tines ? null : tall.length ? "width" : "height",
    clearMm,
    needClearMm: d.minClearMm,
    tines,
  };
}

/** Centre of gravity and handling of a finished crate holding `layout.slots.length` parts of `partKg`. */
export function analyseHandling(
  members: Member[],
  layout: HandlingLayout,
  partKg: number,
  standards: ShopStandards = DEFAULT_STANDARDS,
  cog?: PartCog,
): Handling {
  const masses = [...memberMasses(members, standards), ...partMasses(layout, partKg, cog)];
  const cogMm = centreOfGravity(masses);
  const grossKg = masses.reduce((sum, p) => sum + p.kg, 0);
  const { min: lo, max: hi } = memberBounds(members);
  const footprintMm: [number, number] = [hi[0] - lo[0], hi[1] - lo[1]];
  const offsetMm: [number, number] = [cogMm[0] - (lo[0] + hi[0]) / 2, cogMm[1] - (lo[1] + hi[1]) / 2];

  // The base the crate stands on: the outline of the skids and lifting blocks (or the whole footprint without them).
  const bearers = members.filter(isBearer);
  const base = bearers.length ? bearers : members;
  const {
    min: [bx0, by0, groundZ],
    max: [bx1, by1],
  } = memberBounds(base);
  const heightMm = cogMm[2] - groundZ;
  const toEnd = Math.max(0, Math.min(cogMm[0] - bx0, bx1 - cogMm[0]));
  const toSide = Math.max(0, Math.min(cogMm[1] - by0, by1 - cogMm[1]));
  const tipAngleDeg = (Math.atan2(Math.min(toEnd, toSide), heightMm) * 180) / Math.PI;

  const h = standards.handling;
  // Forks travelling along X are placed across Y by the CoG's Y; along Y, by its X.
  const entries: EntryHandling[] = entryDirections(h.forkEntry).map((direction) => {
    const openings = forkOpenings(members, direction);
    const across = direction === "ends" ? cogMm[1] : cogMm[0];
    return { direction, openings, devices: [fit("forklift", openings, across, h.forklift), fit("pallet-jack", openings, across, h.palletJack)] };
  });
  return {
    cogMm,
    cogBasis: cogBasisOf({ cog }),
    offsetMm,
    footprintMm,
    grossKg,
    heightMm,
    tipAngleDeg,
    tipToward: toSide <= toEnd ? "side" : "end",
    groundZ,
    forkEntry: h.forkEntry,
    entries,
  };
}

/** "120 mm toward the left end and 40 mm toward the back", or null when it is under 1 mm both ways. */
export function offsetText([dx, dy]: [number, number]): Message | null {
  const found = [
    Math.round(Math.abs(dx)) >= 1 && msg`${shopMm(Math.abs(dx))} toward the ${dx < 0 ? "left" : "right"} end`,
    Math.round(Math.abs(dy)) >= 1 && msg`${shopMm(Math.abs(dy))} toward the ${dy < 0 ? "front" : "back"}`,
  ].filter((m): m is Message => !!m);
  return found.length ? joinMessages(found, " and ") : null;
}

/** The sentence that says where the part's own centre of gravity came from (#110). */
const COG_BASIS_TEXT: Record<CogBasis, string> = {
  supplied: "The part's own centre of gravity is the one supplied.",
  estimated: "The part's own centre of gravity is estimated from the model's mesh (uniform density).",
  assumed:
    "The part's own centre of gravity is assumed at the middle of its bounding box: none was supplied, and the mesh could not give one. Enter it in the part details for a lopsided part.",
};

const DEVICE_NAME: Record<Device, string> = { forklift: "Forklift", "pallet-jack": "Pallet jack" };

const DIRECTION_TEXT: Record<ForkDirection, string> = { ends: "the ends", sides: "the sides" };

/** What stands on the ground the forks go between: the skids, or the lifting blocks under them for side entry of a four-way crate. */
const bearerName = (direction: ForkDirection, entry: ForkEntry) => (direction === "sides" && entry === "fourWay" ? "lifting blocks" : "skids");

/** One device from one direction: how it came out and the words for it. `kind` tells the combined row what happened. */
interface DeviceRow {
  level: "ok" | "caution";
  kind: "fits" | "height" | "use-forklift" | "width";
  title: string;
  detail: Message;
}

/**
 * One device against one direction's openings. The words for the ends direction of a crate with
 * ends-only entry are the original ones; any other direction is named in them ("from the sides").
 */
function deviceRow(device: Device, std: DeviceStandard, e: EntryHandling, entry: ForkEntry, multi: boolean): DeviceRow {
  const name = DEVICE_NAME[device];
  const d = e.devices.find((x) => x.device === device)!;
  const forkliftFits = e.devices.some((x) => x.device === "forklift" && x.fits);
  const from = DIRECTION_TEXT[e.direction];
  const bearers = bearerName(e.direction, entry);
  // Say the direction up front where the sentence doesn't already name it.
  const named = multi || e.direction !== "ends";
  const lead = (m: Message): Message => (named ? msg`From ${from}: ${m}` : m);
  const tines = d.device === "forklift" ? "tines" : "forks";
  const widest = e.openings.length ? Math.max(...e.openings.map((o) => o.width)) : 0;
  const clear = msg`${shopMm(d.clearMm)} clear under the floor`;
  const spread = msg`${shopMm(std.tineWidthMm)} ${tines} at a ${shopMm(std.spreadMm.min)}–${shopMm(std.spreadMm.max)} spread`;
  const room = e.openings.length ? msg`the widest opening between the ${bearers} is ${shopMm(widest)}` : parts(`there is no opening between the ${bearers}`);
  if (d.fits) {
    return {
      level: "ok",
      kind: "fits",
      title: `${name} fits from ${from}`,
      detail: msg`${name}: fits from ${from}, ${clear}, needs ${shopMm(d.needClearMm)}. Room between the ${bearers} for ${spread}, either side of the centre of gravity.`,
    };
  }
  if (d.problem === "height") {
    return {
      level: "caution",
      kind: "height",
      title: `${name} may not fit${named ? ` from ${from}` : ""}`,
      detail: msg`${name}: enters from ${from}, ${clear}, needs ${shopMm(d.needClearMm)}. Use taller ${bearers}${d.device === "pallet-jack" && forkliftFits ? " or a forklift" : ""}.`,
    };
  }
  if (d.device === "pallet-jack" && forkliftFits) {
    // Too narrow for a jack is a fact of a small crate, not a defect: a forklift lifts it, so it passes.
    const gap = e.openings.length ? msg`The widest gap between the ${bearers} is ${shopMm(widest)}.` : parts(`There is no gap between the ${bearers}.`);
    return {
      level: "ok",
      kind: "use-forklift",
      title: `Pallet jack won't fit${named ? ` from ${from}` : ""}: use a forklift`,
      detail: lead(msg`${gap} A pallet jack needs ${shopMm(std.spreadMm.min)}–${shopMm(std.spreadMm.max)} across its forks.`),
    };
  }
  return {
    level: "caution",
    kind: "width",
    title: `${name} may not fit${named ? ` from ${from}` : ""}`,
    detail: lead(msg`${name}: ${room}; it needs room for ${spread}, either side of the centre of gravity. Lift it another way, or space the ${bearers} wider.`),
  };
}

/**
 * One check per device. With one direction it is that direction's row; with two (four-way entry)
 * it is a caution if either fails, and says which direction, with every direction's sentence.
 */
function combineRows(id: "forklift" | "pallet-jack", name: string, rows: DeviceRow[], entries: EntryHandling[]): Check<HandlingCheckId> {
  if (rows.length === 1) return { id, level: rows[0].level, title: rows[0].title, detail: rows[0].detail };
  const directions = (kind: DeviceRow["kind"][]) =>
    entries
      .filter((_, i) => kind.includes(rows[i].kind))
      .map((e) => DIRECTION_TEXT[e.direction])
      .join(" and ");
  const failing = directions(["height", "width"]);
  const forkliftOnly = directions(["use-forklift"]);
  const level = rows.some((r) => r.level === "caution") ? "caution" : "ok";
  const title = failing
    ? `${name} may not fit from ${failing}`
    : forkliftOnly
      ? `Pallet jack won't fit from ${forkliftOnly}: use a forklift`
      : `${name} fits from all four sides`;
  return {
    id,
    level,
    title,
    detail: joinMessages(
      rows.map((r) => r.detail),
      " ",
    ),
  };
}

/**
 * The CoG and handling checks (spec §7.7, §7.14), in this order: `cog-offset`, `cog-tip`,
 * then `hand-carry` (a light crate) or `forklift` and `pallet-jack`. Thresholds are the shop standards' `handling` group.
 */
export function handlingChecks(h: Handling, standards: ShopStandards = DEFAULT_STANDARDS): Check<HandlingCheckId>[] {
  const s = standards.handling;
  const checks: Check<HandlingCheckId>[] = [];

  const [L, W] = h.footprintMm;
  const limX = s.cogOffsetRatio * L;
  const limY = s.cogOffsetRatio * W;
  const pct = `${Math.round(s.cogOffsetRatio * 100)}%`;
  const where = offsetText(h.offsetMm);
  const off = Math.abs(h.offsetMm[0]) > limX || Math.abs(h.offsetMm[1]) > limY;
  const basis = COG_BASIS_TEXT[h.cogBasis];
  checks.push(
    off
      ? {
          id: "cog-offset",
          level: "caution",
          title: "Off-centre centre of gravity",
          detail: msg`Centre of gravity is ${where ?? []}; mark it on the crate. The limit is ${pct} of the length (${mm(limX)}) and width (${mm(limY)}). ${basis}`,
        }
      : {
          id: "cog-offset",
          level: "ok",
          title: "Centre of gravity near the middle",
          detail: msg`${where ? msg`It is ${where}` : "It is on both centre lines"}, within ${pct} of the length (${mm(limX)}) and width (${mm(limY)}). ${mm(h.heightMm)} above the ground. ${basis}`,
        },
  );

  const angle = `${Math.round(h.tipAngleDeg)}°`;
  const toward = h.tipToward === "side" ? "over a side" : "over an end";
  checks.push(
    h.tipAngleDeg < s.minTipAngleDeg
      ? {
          id: "cog-tip",
          level: "caution",
          title: "Top-heavy",
          detail: msg`The centre of gravity is ${mm(h.heightMm)} up, so the crate tips ${toward} at ${angle}, under the ${s.minTipAngleDeg}° limit. Strap it down, mark the centre of gravity, or pick a lower layout.`,
        }
      : {
          id: "cog-tip",
          level: "ok",
          title: "Low centre of gravity",
          detail: msg`The centre of gravity is ${mm(h.heightMm)} up; the crate tips ${toward} only past ${angle}. The limit is ${s.minTipAngleDeg}°.`,
        },
  );

  // One person can lift it, so no device is needed: one passing row stands in for the two.
  if (s.handCarryMaxKg > 0 && h.grossKg <= s.handCarryMaxKg) {
    checks.push({
      id: "hand-carry",
      level: "ok",
      title: "Light enough to carry by hand",
      detail: msg`Gross ${kg(h.grossKg)}, at or under the ${kg(s.handCarryMaxKg)} hand-carry limit, so it needs no forklift or pallet jack.`,
    });
    return checks;
  }

  for (const device of ["forklift", "pallet-jack"] as const) {
    const std = device === "forklift" ? s.forklift : s.palletJack;
    const name = DEVICE_NAME[device];
    const rows = h.entries.map((e) => deviceRow(device, std, e, h.forkEntry, h.entries.length > 1));
    checks.push(combineRows(device, name, rows, h.entries));
  }
  return checks;
}

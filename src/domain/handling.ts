import type { Check, HandlingCheckId } from "./check";
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
 * corner on top of the floor, Z up, X along the length (skids run along X, so forks enter
 * from the ends, −X and +X). The ground is the bottom of the skids, at negative Z.
 */

/** What the part placements need of a layout. The orientation turns the part's centre of gravity; without one the part is as modelled. */
type HandlingLayout = Pick<Layout, "slots" | "cellSize"> & Partial<Pick<Layout, "orientation">>;

/** A point mass. */
interface MassPoint {
  at: Vec3;
  kg: number;
}

/** The space between two neighbouring skids, along the whole length, open at both ends. */
export interface Opening {
  /** Lower Y edge, crate-interior mm. */
  y: number;
  /** Clear width between the skids. */
  width: number;
  /** Clear height from the ground to the lowest board above the opening (the floor). */
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
  /** Fork openings between the skids, front (−Y) first. */
  openings: Opening[];
  devices: DeviceFit[];
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

/**
 * The openings between neighbouring skids, read from the members. The clear height is from the
 * ground to the lowest non-skid board over the opening, so anything hung under the floor counts.
 */
export function forkOpenings(members: Member[]): Opening[] {
  const skids = members.filter((m) => m.kind === "skid").sort((p, q) => p.min[1] - q.min[1]);
  if (skids.length < 2) return [];
  const groundZ = Math.min(...skids.map((s) => s.min[2]));
  const others = members.filter((m) => m.kind !== "skid");
  const out: Opening[] = [];
  let edge = skids[0].min[1] + skids[0].size[1];
  for (const s of skids.slice(1)) {
    const y0 = edge;
    const y1 = s.min[1];
    edge = Math.max(edge, s.min[1] + s.size[1]);
    if (y1 - y0 <= 0.5) continue;
    const above = others.filter((m) => m.min[1] < y1 && m.min[1] + m.size[1] > y0).map((m) => m.min[2]);
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

  // The base the crate stands on: the skids' outline (or the whole footprint without skids).
  const skids = members.filter((m) => m.kind === "skid");
  const base = skids.length ? skids : members;
  const {
    min: [bx0, by0, groundZ],
    max: [bx1, by1],
  } = memberBounds(base);
  const heightMm = cogMm[2] - groundZ;
  const toEnd = Math.max(0, Math.min(cogMm[0] - bx0, bx1 - cogMm[0]));
  const toSide = Math.max(0, Math.min(cogMm[1] - by0, by1 - cogMm[1]));
  const tipAngleDeg = (Math.atan2(Math.min(toEnd, toSide), heightMm) * 180) / Math.PI;

  const openings = forkOpenings(members);
  const h = standards.handling;
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
    openings,
    devices: [fit("forklift", openings, cogMm[1], h.forklift), fit("pallet-jack", openings, cogMm[1], h.palletJack)],
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

  const widest = h.openings.length ? Math.max(...h.openings.map((o) => o.width)) : 0;
  const forkliftFits = h.devices.some((d) => d.device === "forklift" && d.fits);
  for (const d of h.devices) {
    const std = d.device === "forklift" ? s.forklift : s.palletJack;
    const name = DEVICE_NAME[d.device];
    const tines = d.device === "forklift" ? "tines" : "forks";
    const clear = msg`${shopMm(d.clearMm)} clear under the floor`;
    const spread = msg`${shopMm(std.tineWidthMm)} ${tines} at a ${shopMm(std.spreadMm.min)}–${shopMm(std.spreadMm.max)} spread`;
    const room = h.openings.length ? msg`the widest opening between the skids is ${shopMm(widest)}` : parts("there is no opening between the skids");
    if (d.fits) {
      checks.push({
        id: d.device,
        level: "ok",
        title: `${name} fits from the ends`,
        detail: msg`${name}: fits from the ends, ${clear}, needs ${shopMm(d.needClearMm)}. Room between the skids for ${spread}, either side of the centre of gravity.`,
      });
    } else if (d.problem === "height") {
      checks.push({
        id: d.device,
        level: "caution",
        title: `${name} may not fit`,
        detail: msg`${name}: enters from the ends, ${clear}, needs ${shopMm(d.needClearMm)}. Use taller skids${d.device === "pallet-jack" && forkliftFits ? " or a forklift" : ""}.`,
      });
    } else if (d.device === "pallet-jack" && forkliftFits) {
      // Too narrow for a jack is a fact of a small crate, not a defect: a forklift lifts it, so it passes.
      const gap = h.openings.length ? msg`The widest gap between the skids is ${shopMm(widest)}.` : parts("There is no gap between the skids.");
      checks.push({
        id: d.device,
        level: "ok",
        title: "Pallet jack won't fit: use a forklift",
        detail: msg`${gap} A pallet jack needs ${shopMm(std.spreadMm.min)}–${shopMm(std.spreadMm.max)} across its forks.`,
      });
    } else {
      checks.push({
        id: d.device,
        level: "caution",
        title: `${name} may not fit`,
        detail: msg`${name}: ${room}; it needs room for ${spread}, either side of the centre of gravity. Lift it another way, or space the skids wider.`,
      });
    }
  }
  return checks;
}

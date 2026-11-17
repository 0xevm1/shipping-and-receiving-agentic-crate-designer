import { DEFAULT_STANDARDS, type ShopStandards } from "./standards";

/**
 * Structural sizing (spec §7.15): how many skids, of which section, whether the floor
 * needs joists, and how the lid is framed, from the load and the spans.
 *
 * Simple, conservative timber rules, in N and mm (so stresses are MPa = N/mm²). `f` is
 * `structure.loadFactor` and g = 9.81 N/kg.
 *
 * - **Skids** carry everything: the payload plus the crate's own weight above them (`dead`:
 *   floor, walls, lid, dunnage), `W = f g (payload + dead)`. They run the full length and are
 *   taken as simply supported at their two ends (resting on blocks, uneven ground or fork tines
 *   near the ends), span `L = extL`. An inner skid carries `1 / (n − 1)` of the load (its share of
 *   the floor either side); with two skids each carries half (`W_s = share × W`).
 *   Bending `W_s L / 8 ≤ Fb b h² / 6`; shear `1.5 (W_s / 2) / (b h) ≤ Fv`; bearing at each end
 *   `(W_s / 2) / (b × supportLength) ≤ Fc⊥`.
 * - **Floor and joists** carry the contents: the payload plus the dunnage inside
 *   (`W_c = f g (payload + contents)`), spread over the interior footprint `A = L × W`, so the
 *   pressure is `q = W_c / A`. (The walls stand on the floor's edge, over the outer skids.)
 *   - **Floor plywood** `t` thick, a simple span `s` between supports, centre to centre:
 *     per mm of width `q s² / 8 ≤ Fb_ply t² / 6`. Without joists `s` is the skid spacing across
 *     the width; with joists, the joist spacing along the length.
 *   - **Floor joists** lie on edge across the skids, span the skid spacing `ss`, and each carries
 *     a floor strip `sj` wide: bending `q sj ss² / 8 ≤ Fb t h² / 6`; shear
 *     `1.5 (q sj ss / 2) / (t h) ≤ Fv`; bearing on an inner skid `q sj ss / (t b) ≤ Fc⊥`.
 * - **Lid** (only when crates may be stacked, `structure.lidStackKg > 0`): the stacked weight,
 *   times `f`, spread over the lid. Cross members span the lid's width; the lid plywood spans
 *   between them. Otherwise the lid is the nominal frame.
 *
 * Every check is linear in its load, so each gives the most load it carries; less the dead
 * weight on that member, that is the payload it allows. The smallest is the base rating.
 * Wood and screws only: no metal plates or brackets.
 */

/** Standard gravity, N per kg. */
export const G = 9.81;

/** A lumber section as laid: `wide` across the member, `tall` vertical. */
export interface LaidSection {
  wide: number;
  tall: number;
}

type MemberCheckId =
  | "skid-bending"
  | "skid-shear"
  | "skid-bearing"
  | "floor-bending"
  | "joist-bending"
  | "joist-shear"
  | "joist-bearing"
  | "lid-member-bending"
  | "lid-panel-bending";

/** One structural check. */
interface MemberCheck {
  id: MemberCheckId;
  /** "skid bending", for messages. */
  label: string;
  /** Most load (kg, before the load factor) the member carries at its allowable stress. */
  capacityKg: number;
  /** The payload that leaves: `capacityKg` less the dead weight this member carries. */
  payloadKg: number;
}

/** The dead weight above the skids, kg: all of it (on the skids) and the part inside (on the floor). */
interface DeadLoad {
  allKg: number;
  contentsKg: number;
}

export interface BaseInput {
  /** Outside length and width of the crate, mm (the skid and joist lengths). */
  extL: number;
  extW: number;
  /** Interior footprint the contents stand on, mm². */
  floorAreaMm2: number;
  payloadKg: number;
  dead: DeadLoad;
  floorMm: number;
  /** Skid sections to choose from, smallest first. */
  skids: LaidSection[];
  standards?: ShopStandards;
}

interface BasePlan {
  skid: LaidSection;
  skidCount: number;
  /** Floor joists across the skids, or null. `wide` is along the crate (X), `tall` vertical. */
  joist: LaidSection | null;
  joistCount: number;
  /** Clear opening between neighbouring skids, mm (the fork entry). */
  skidOpeningMm: number;
  /** Floor span between supports, centre to centre, mm. */
  floorSpanMm: number;
  /** Why the floor has joists, or null when it has none. */
  joistReason: "payload" | "floor-span" | null;
  /** Skid, floor and joist checks for the chosen base. */
  checks: MemberCheck[];
  /** The check that allows the least payload. */
  governing: MemberCheck;
  /** False when no skid count, section and joist spacing from stock carries the load. */
  ok: boolean;
}

/** Most skids across `extW` that keep `minOpening` clear between neighbours (at least 2). */
export function maxSkidCount(extW: number, skidWide: number, minOpening: number): number {
  // (extW − n b) / (n − 1) ≥ o  ⇔  n ≤ (extW + o) / (b + o)
  return Math.max(2, Math.floor((extW + minOpening) / (skidWide + minOpening) + 1e-9));
}

/** Fewest skids by the spacing rule: `max(2, ceil(extW / skidSpacingMm) + 1)`. */
export function minSkidCount(extW: number, standards: ShopStandards = DEFAULT_STANDARDS): number {
  return Math.max(2, Math.ceil(extW / standards.construction.skidSpacingMm) + 1);
}

/** Share of the load on the most loaded skid: half with two skids, else an inner skid's 1 / (n − 1). */
export function skidShare(n: number): number {
  return n <= 2 ? 0.5 : 1 / (n - 1);
}

/** Newtons of design load → kg of unfactored load. */
const kgOf = (newtons: number, standards: ShopStandards) => newtons / (G * standards.structure.loadFactor);

const check = (id: MemberCheckId, label: string, capacityKg: number, deadKg: number): MemberCheck => ({
  id,
  label,
  capacityKg,
  payloadKg: capacityKg - deadKg,
});

/** Skid checks for `n` skids of `skid` over the span `L`, carrying `deadKg` besides the payload. */
export function skidChecks(skid: LaidSection, n: number, L: number, deadKg: number, standards: ShopStandards = DEFAULT_STANDARDS): MemberCheck[] {
  const s = standards.structure;
  const share = skidShare(n);
  const { wide: b, tall: h } = skid;
  return [
    check("skid-bending", "skid bending", kgOf((8 * s.lumberBendingMPa * ((b * h * h) / 6)) / (L * share), standards), deadKg),
    check("skid-shear", "skid shear", kgOf((2 * s.lumberShearMPa * b * h) / (1.5 * share), standards), deadKg),
    check("skid-bearing", "skid bearing", kgOf((2 * s.lumberBearingMPa * b * s.supportLengthMm) / share, standards), deadKg),
  ];
}

/** Floor plywood `t` thick over a simple span `span`, under a load spread over `area` mm². */
export function floorCheck(t: number, span: number, area: number, deadKg: number, standards: ShopStandards = DEFAULT_STANDARDS): MemberCheck {
  // q s² / 8 ≤ Fb t² / 6 per mm of width, q = W / area.
  const W = (8 * standards.structure.plywoodBendingMPa * ((t * t) / 6) * area) / (span * span);
  return check("floor-bending", "floor bending", kgOf(W, standards), deadKg);
}

/** Joist checks: joists `sj` apart, spanning `ss` between skids `skidWide` wide, load over `area`. */
export function joistChecks(
  joist: LaidSection,
  sj: number,
  ss: number,
  skidWide: number,
  area: number,
  deadKg: number,
  standards: ShopStandards = DEFAULT_STANDARDS,
): MemberCheck[] {
  const s = standards.structure;
  const { wide: t, tall: h } = joist;
  return [
    check("joist-bending", "floor joist bending", kgOf((8 * s.lumberBendingMPa * ((t * h * h) / 6) * area) / (sj * ss * ss), standards), deadKg),
    check("joist-shear", "floor joist shear", kgOf((2 * s.lumberShearMPa * t * h * area) / (1.5 * sj * ss), standards), deadKg),
    check("joist-bearing", "floor joist bearing on the skids", kgOf((s.lumberBearingMPa * t * skidWide * area) / (sj * ss), standards), deadKg),
  ];
}

const governingOf = (checks: MemberCheck[]) => checks.reduce((a, b) => (b.payloadKg < a.payloadKg ? b : a));

/** Centre-to-centre spacing of `count` members `width` wide spread over `span`. */
export const pitch = (span: number, width: number, count: number) => (span - width) / Math.max(1, count - 1);

/**
 * Sizes the base for one crate. For each skid count from the spacing rule up to the most that
 * keep `minForkOpeningMm` clear, it takes the smallest skid section that passes; with none, it
 * adds a skid. The floor gets joists above `joistOverKg` of payload, or when it fails over the
 * skids; joists are spread at most `maxJoistSpacingMm` apart, closer if the floor or the joists
 * need it, keeping at least a joist's width between them. When nothing passes, it returns the
 * strongest base it tried with `ok: false`.
 */
export function sizeBase(input: BaseInput): BasePlan {
  const standards = input.standards ?? DEFAULT_STANDARDS;
  const s = standards.structure;
  const { extL, extW, floorMm, skids, floorAreaMm2: area, payloadKg, dead } = input;
  const contentsLoad = payloadKg + dead.contentsKg;
  const joistStock: LaidSection = { wide: standards.stock.joistMm.thick, tall: standards.stock.joistMm.wide };
  const widest = Math.max(...skids.map((k) => k.wide));
  const nMin = minSkidCount(extW, standards);
  const nMax = Math.max(nMin, maxSkidCount(extW, widest, s.minForkOpeningMm));
  const mMin = Math.max(2, Math.ceil(extL / s.maxJoistSpacingMm) + 1);
  // At least one joist width clear between joists: (extL − m t) / (m − 1) ≥ t.
  const mMax = Math.max(mMin, Math.floor((extL + joistStock.wide) / (2 * joistStock.wide)));

  const plan = (skid: LaidSection, n: number, forceJoists: boolean): BasePlan => {
    const ss = pitch(extW, skid.wide, n);
    const checks = skidChecks(skid, n, extL, dead.allKg, standards);
    const overSkids = floorCheck(floorMm, ss, area, dead.contentsKg, standards);
    const reason = payloadKg > s.joistOverKg ? "payload" : overSkids.payloadKg < payloadKg ? "floor-span" : null;
    let joist: LaidSection | null = null;
    let joistCount = 0;
    let floorSpanMm = ss;
    if (reason || forceJoists) {
      joist = joistStock;
      // Each check at a pitch of 1 mm; the floor's capacity falls as 1 / pitch², the joists' as 1 / pitch.
      const unit = [floorCheck(floorMm, 1, area, 0, standards), ...joistChecks(joistStock, 1, ss, skid.wide, area, 0, standards)];
      const widestPitch = (c: MemberCheck) => (c.id === "floor-bending" ? Math.sqrt(c.capacityKg / contentsLoad) : c.capacityKg / contentsLoad);
      const maxPitch = Math.min(...unit.map(widestPitch));
      const needed = Math.ceil((extL - joistStock.wide) / maxPitch - 1e-9) + 1;
      joistCount = Math.min(mMax, Math.max(mMin, needed));
      floorSpanMm = pitch(extL, joistStock.wide, joistCount);
      checks.push(
        floorCheck(floorMm, floorSpanMm, area, dead.contentsKg, standards),
        ...joistChecks(joistStock, floorSpanMm, ss, skid.wide, area, dead.contentsKg, standards),
      );
    } else {
      checks.push(overSkids);
    }
    const governing = governingOf(checks);
    return {
      skid: { ...skid },
      skidCount: n,
      joist,
      joistCount,
      skidOpeningMm: (extW - n * skid.wide) / (n - 1),
      floorSpanMm,
      joistReason: joist ? (reason ?? "floor-span") : null,
      checks,
      governing,
      ok: governing.payloadKg >= payloadKg,
    };
  };

  for (let n = nMin; n <= nMax; n++) {
    for (const skid of skids) {
      const p = plan(skid, n, false);
      if (p.ok) return p;
    }
  }
  // Nothing passes: the strongest base tried, with joists.
  return plan(skids[skids.length - 1], nMax, true);
}

interface LidInput {
  /** Lid panel length (X) and width (Y), mm. */
  lidL: number;
  lidW: number;
  panelMm: number;
  /** The nominal frame: cleat stock laid flat, at most `maxCleatSpacingMm` apart. */
  nominalCount: number;
  standards?: ShopStandards;
}

interface LidPlan {
  /** Section of the lid edge and cross members as laid: `wide` along X, `tall` vertical. */
  member: LaidSection;
  /** Cross members (the two edge members are extra). */
  count: number;
  /** True when the members are joist stock on edge rather than flat cleats. */
  joists: boolean;
  /** The stacking load the lid is sized for, kg (0: crates are not stacked, nominal lid). */
  stackKg: number;
  /** The lid's checks; empty for the nominal lid. */
  checks: MemberCheck[];
  /** Most stacked weight (kg) the lid carries; null for the nominal lid. */
  capacityKg: number | null;
  ok: boolean;
}

/** Lid checks for cross members `member` at pitch `p` across `lidW`, plywood `t` between them. */
function lidChecks(member: LaidSection, p: number, lidL: number, lidW: number, t: number, standards: ShopStandards = DEFAULT_STANDARDS): MemberCheck[] {
  const s = standards.structure;
  const area = lidL * lidW;
  const { wide: b, tall: h } = member;
  return [
    check("lid-member-bending", "lid cross member bending", kgOf((8 * s.lumberBendingMPa * ((b * h * h) / 6) * area) / (p * lidW * lidW), standards), 0),
    check("lid-panel-bending", "lid panel bending", kgOf((8 * s.plywoodBendingMPa * ((t * t) / 6) * area) / (p * p), standards), 0),
  ];
}

/**
 * Sizes the lid. With `structure.lidStackKg` 0 (the default: crates aren't stacked) it is the
 * nominal frame: cleats laid flat at `nominalCount`. Otherwise it tries flat
 * cleats down to half the nominal spacing, then joist stock on edge from the nominal count up
 * (keeping a member's width clear between members) until the members and the plywood between
 * them carry the stacked load.
 */
export function sizeLid(input: LidInput): LidPlan {
  const standards = input.standards ?? DEFAULT_STANDARDS;
  const { lidL, lidW, panelMm, nominalCount } = input;
  const stackKg = standards.structure.lidStackKg;
  const flat: LaidSection = { wide: standards.stock.cleatMm.wide, tall: standards.stock.cleatMm.thick };
  if (stackKg <= 0) return { member: flat, count: nominalCount, joists: false, stackKg: 0, checks: [], capacityKg: null, ok: true };
  const onEdge: LaidSection = { wide: standards.stock.joistMm.thick, tall: standards.stock.joistMm.wide };
  let last: LidPlan | null = null;
  for (const [member, joists] of [
    [flat, false],
    [onEdge, true],
  ] as const) {
    const most = Math.max(nominalCount, Math.floor((lidL + member.wide) / (2 * member.wide)));
    for (let count = nominalCount; count <= most; count++) {
      if (!joists && count > nominalCount && pitch(lidL, member.wide, count) < standards.construction.maxCleatSpacingMm / 2) break;
      const checks = lidChecks(member, pitch(lidL, member.wide, count), lidL, lidW, panelMm, standards);
      const capacityKg = governingOf(checks).capacityKg;
      last = { member: { ...member }, count, joists, stackKg, checks, capacityKg, ok: capacityKg >= stackKg };
      if (last.ok) return last;
    }
  }
  return last!;
}

/** Wall uprights and lid cross cleats over `span`: at most `maxCleatSpacingMm` apart, at least 2. */
export function frameCount(span: number, standards: ShopStandards = DEFAULT_STANDARDS): number {
  return Math.max(2, Math.ceil(span / standards.construction.maxCleatSpacingMm) + 1);
}

/** What `planStructure` needs from a layout: its interior and grid, before the crate is drawn. */
interface StructureGrid {
  interior: [number, number, number];
  cellSize: [number, number, number];
  counts: [number, number, number];
  clearance: [number, number, number];
}

/** The materials `resolveConstruction` picks from the payload, before the structure is sized. */
export interface StructureMaterials {
  panelMm: number;
  floorMm: number;
  cleat: { thick: number; wide: number };
  /** Skid sections allowed for this payload, smallest first. */
  skids: LaidSection[];
}

export interface StructurePlan {
  base: BasePlan;
  lid: LidPlan;
  /** Estimated crate weight above the skids, and the part of it inside (an upper bound; see `estimateDeadLoad`). */
  dead: DeadLoad;
  /** Skids + joists + floor, mm: the bottom of the skids to the top of the floor. */
  baseMm: number;
  /** The base rating: most payload the base carries, `base.governing.payloadKg` (never below 0). */
  ratedPayloadKg: number;
}

/** Blocking posts the estimate allows each part: one on each of its four vertical sides. */
const POSTS_PER_PART = 4;
/** Bearers the estimate allows each part in the bottom layer: the two strips `addDunnage` lays under it. */
const BEARERS_PER_PART = 2;

/**
 * Upper bound on the crate's weight above the skids, from the layout alone, so the packer and
 * `designCrate` size the same base: plywood (floor, walls, lid, separators) and the wall and lid
 * framing exactly, and the dunnage as if every part had `POSTS_PER_PART` full-height posts as
 * thick as the widest gap and `BEARERS_PER_PART` bearers. `contentsKg` is the separators and
 * dunnage, which load the floor.
 */
function estimateDeadLoad(
  grid: StructureGrid,
  m: StructureMaterials,
  lid: LidPlan,
  partGapMm: number,
  standards: ShopStandards = DEFAULT_STANDARDS,
): DeadLoad {
  const [L, W, H] = grid.interior;
  const [a, , c] = grid.cellSize;
  const [nx, ny, nz] = grid.counts;
  const [clearX, clearY, clearZ] = grid.clearance;
  const t = m.panelMm;
  const { thick: ct, wide: cw } = m.cleat;
  const extL = L + 2 * (t + ct);
  const extW = W + 2 * (t + ct);
  const rho = standards.rates.densityKgM3;
  const shellPly = extL * extW * m.floorMm + 2 * (L + 2 * t) * H * t + 2 * W * H * t + (L + 2 * t) * (W + 2 * t) * t;
  const upright = Math.max(0, H - 2 * cw);
  const wallFrame = (2 * (2 * (L + 2 * t) + frameCount(L + 2 * t, standards) * upright) + 2 * (2 * extW + frameCount(extW, standards) * upright)) * ct * cw;
  const lidFrame = (2 * (L + 2 * t) + lid.count * (W + 2 * t)) * lid.member.wide * lid.member.tall;
  const bw = standards.stock.blockWidthMm;
  const postMm3 = bw * Math.max(partGapMm, clearX, clearY) * (clearZ + c + partGapMm);
  const bearerMm3 = a * bw * clearZ;
  const dunnage = nx * ny * nz * (POSTS_PER_PART * postMm3 + BEARERS_PER_PART * bearerMm3);
  const separators = (nz - 1) * L * W * t;
  const contentsKg = (separators * rho.plywood + dunnage * rho.lumber) / 1e9;
  return { allKg: contentsKg + (shellPly * rho.plywood + (wallFrame + lidFrame) * rho.lumber) / 1e9, contentsKg };
}

/** Sizes the base and lid for a layout. Pure; the packer and `designCrate` both call it. */
export function planStructure(
  grid: StructureGrid,
  m: StructureMaterials,
  payloadKg: number,
  partGapMm: number,
  standards: ShopStandards = DEFAULT_STANDARDS,
): StructurePlan {
  const [L, W] = grid.interior;
  const t = m.panelMm;
  const extL = L + 2 * (t + m.cleat.thick);
  const extW = W + 2 * (t + m.cleat.thick);
  const lid = sizeLid({ lidL: L + 2 * t, lidW: W + 2 * t, panelMm: t, nominalCount: frameCount(L + 2 * t, standards), standards });
  const dead = estimateDeadLoad(grid, m, lid, partGapMm, standards);
  const base = sizeBase({ extL, extW, floorAreaMm2: L * W, payloadKg, dead, floorMm: m.floorMm, skids: m.skids, standards });
  const baseMm = base.skid.tall + (base.joist ? base.joist.tall : 0) + m.floorMm;
  return { base, lid, dead, baseMm, ratedPayloadKg: Math.max(0, base.governing.payloadKg) };
}

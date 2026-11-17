/**
 * Size-line geometry and the "photon pulse" that runs along it (#65). Pure TypeScript (no
 * three.js, no React), in crate-interior mm, so it is unit-tested directly.
 *
 * - `buildLines`: the dimension segments and label anchors that `DimensionLines` draws.
 * - `pulsePaths`: each dimension as a small graph (nodes at segment ends and junctions, the label
 *   anchor as the source), walked breadth-first into photon legs that split at every vertex.
 * - `tickPulse`: the 10 s clock that fires pulses.
 */
import type { CrateDesign } from "@/domain/crate";
import type { Vec3 } from "@/domain/schema";

export type Seg = [Vec3, Vec3];
export type Where = "front" | "right" | "part";
export interface Anchor {
  at: Vec3;
  value: number;
  where: Where;
  /** Index in `lines[where]` of the dimension line this label sits on. */
  seg: number;
}

/** Seconds from the crate first framing (the size lines mounting) to the first pulse. */
export const PULSE_FIRST_S = 2;
/** Seconds between pulses. */
export const PULSE_PERIOD_S = 10;
/** Seconds from the photons emerging to the last fade. */
export const PULSE_DURATION_S = 1.35;
/**
 * Delay between dimensions (length → width → height → part), s. 0 = all pulse together, which
 * is the choice made in #65: one quiet beat rather than a sweep that pulls the eye round the crate.
 */
export const PULSE_STAGGER_S = 0;
/** Tail length as a share of the dimension line. */
export const PULSE_TAIL = 0.1;
/** Longest stretch a pulse is on screen (with the stagger of up to six dimensions). */
export const PULSE_ACTIVE_S = PULSE_DURATION_S + 5 * PULSE_STAGGER_S;
/** Largest frame step the clock accepts, s; as `Director`, so a long gap never jumps ahead. */
const MAX_DT = 0.1;

const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/**
 * Size lines, in crate-interior mm. Crate: length along the front bottom edge, width along the
 * right bottom edge, height at the back right corner, each with witness lines from the crate
 * corners out past the dimension line to a tick end. Part (`withPart`): three edges of one part
 * (top layer, front row, rightmost).
 */
export function buildLines(design: CrateDesign, withPart: boolean) {
  const { layout, construction } = design;
  const ext = layout.external;
  const o = construction.panelMm + construction.cleat.thick;
  const mn: Vec3 = [-o, -o, -construction.floorMm - construction.skid.tall];
  const mx: Vec3 = [mn[0] + ext[0], mn[1] + ext[1], mn[2] + ext[2]];
  const longest = Math.max(...ext);
  const off = 110 + longest * 0.05;
  const tick = 40 + longest * 0.0125;
  const z = mn[2];

  const La: Vec3 = [mn[0], mn[1] - off, z];
  const Lb: Vec3 = [mx[0], mn[1] - off, z];
  const Wa: Vec3 = [mx[0] + off, mn[1], z];
  const Wb: Vec3 = [mx[0] + off, mx[1], z];
  const Hb: Vec3 = [mx[0] + off, mx[1], mx[2]];

  const lines: Record<Where, Seg[]> = {
    front: [
      [La, Lb],
      [[mn[0], mn[1], z], [mn[0], mn[1] - off - tick, z]],
      [[mx[0], mn[1], z], [mx[0], mn[1] - off - tick, z]],
    ],
    right: [
      [Wa, Wb],
      [[mx[0], mn[1], z], [mx[0] + off + tick, mn[1], z]],
      [[mx[0], mx[1], z], [mx[0] + off + tick, mx[1], z]],
      [Wb, Hb],
      [[mx[0], mx[1], mx[2]], [mx[0] + off + tick, mx[1], mx[2]]],
    ],
    part: [],
  };
  const anchors: Anchor[] = [
    { at: mid(La, Lb), value: ext[0], where: "front", seg: 0 },
    { at: mid(Wa, Wb), value: ext[1], where: "right", seg: 0 },
    { at: mid(Wb, Hb), value: ext[2], where: "right", seg: 3 },
  ];

  if (withPart && layout.slots.length) {
    const top = Math.max(...layout.slots.map((s) => s.index[2]));
    const row = layout.slots.filter((s) => s.index[2] === top && s.index[1] === 0);
    const s0 = row.reduce((a, b) => (b.index[0] > a.index[0] ? b : a));
    const c = layout.cellSize;
    const p = s0.min;
    const q: Vec3 = [p[0] + c[0], p[1] + c[1], p[2] + c[2]];
    const edges: [Seg, number][] = [
      [[[p[0], p[1], q[2]], [q[0], p[1], q[2]]], c[0]],
      [[[q[0], p[1], q[2]], [q[0], q[1], q[2]]], c[1]],
      [[[q[0], p[1], p[2]], [q[0], p[1], q[2]]], c[2]],
    ];
    for (const [seg, value] of edges) {
      anchors.push({ at: mid(...seg), value, where: "part", seg: lines.part.length });
      lines.part.push(seg);
    }
  }
  return { lines, anchors };
}

/** One photon's run along one stretch between two graph nodes. */
export interface PhotonLeg {
  from: Vec3;
  to: Vec3;
  /** Path distance from the anchor at `from` and `to`, mm. */
  start: number;
  end: number;
  /** `start` and `end` as a share of the pulse's longest path (0 at the anchor, 1 at the furthest end). */
  startTime: number;
  endTime: number;
  /** No leg continues from `to`: the photon fades here. */
  leaf: boolean;
}

export interface DimensionPulse {
  where: Where;
  anchor: Vec3;
  legs: PhotonLeg[];
  /** Longest path from the anchor to an end, mm. */
  total: number;
  /** Tail length, mm. */
  tail: number;
  /** Delay after the pulse fires, s. */
  delay: number;
}

const EPS = 1e-6;
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const same = (a: Vec3, b: Vec3) => dist(a, b) < EPS;

/** Parameter of `p` along segment `s` (0..1) when `p` lies on it, else null. */
function along(s: Seg, p: Vec3): number | null {
  const [a, b] = s;
  const len = dist(a, b);
  if (len < EPS) return null;
  const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]) + (p[2] - a[2]) * (b[2] - a[2])) / (len * len);
  if (t < -EPS || t > 1 + EPS) return null;
  const foot: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  return dist(foot, p) < 1e-3 ? t : null;
}

/**
 * The photon paths for one dimension. The graph holds the dimension line (`segs[label.seg]`) and
 * the witness lines that touch its ends; other dimension lines (`others`) are left out, so the
 * width photon doesn't run up the height line. Nodes are segment ends, the points where the
 * dimension line meets a witness line, and the label anchor; edges join neighbouring nodes along
 * each segment. A breadth-first walk out of the anchor (nearest first) gives each edge once, in
 * the direction travelled, so a photon splits at every vertex and never turns back.
 */
export function pulsePaths(segs: Seg[], label: Anchor, others: number[] = [], delay = 0): DimensionPulse {
  const { seg: dimIndex, at: anchor, where } = label;
  const dim = segs[dimIndex];
  const member = segs.filter(
    (s, i) => i === dimIndex || (!others.includes(i) && (along(s, dim[0]) !== null || along(s, dim[1]) !== null)),
  );

  const nodes: Vec3[] = [];
  const node = (p: Vec3) => {
    const i = nodes.findIndex((n) => same(n, p));
    return i >= 0 ? i : nodes.push(p) - 1;
  };
  const source = node(anchor);
  for (const s of member) s.forEach(node);

  const adj: number[][] = nodes.map(() => []);
  for (const s of member) {
    const on = nodes
      .map((p, i) => ({ i, t: along(s, p) }))
      .filter((x): x is { i: number; t: number } => x.t !== null)
      .sort((a, b) => a.t - b.t);
    for (let k = 1; k < on.length; k++) {
      adj[on[k - 1].i].push(on[k].i);
      adj[on[k].i].push(on[k - 1].i);
    }
  }

  const reach = nodes.map(() => Infinity);
  reach[source] = 0;
  const raw: Omit<PhotonLeg, "startTime" | "endTime" | "leaf">[] = [];
  const queue = [source];
  while (queue.length) {
    queue.sort((a, b) => reach[a] - reach[b]);
    const n = queue.shift()!;
    for (const m of adj[n]) {
      if (reach[m] !== Infinity) continue;
      reach[m] = reach[n] + dist(nodes[n], nodes[m]);
      raw.push({ from: nodes[n], to: nodes[m], start: reach[n], end: reach[m] });
      queue.push(m);
    }
  }

  const total = Math.max(EPS, ...raw.map((l) => l.end));
  const legs = raw.map((l) => ({
    ...l,
    startTime: l.start / total,
    endTime: l.end / total,
    leaf: !raw.some((q) => q.from === l.to),
  }));
  return { where, anchor, legs, total, tail: PULSE_TAIL * dist(dim[0], dim[1]), delay };
}

/** Photon paths for every label, in label order (crate length, width, height, then the part). */
export function dimensionPulses(lines: Record<Where, Seg[]>, anchors: Anchor[]): DimensionPulse[] {
  return anchors.map((a, i) => {
    const others = anchors.filter((b) => b.where === a.where && b !== a).map((b) => b.seg);
    return pulsePaths(lines[a.where], a, others, i * PULSE_STAGGER_S);
  });
}

/** Pulse clock state; one per mounted set of size lines. */
export interface PulseClock {
  /** Running time, s (only advances while on). */
  t: number;
  /** When the next pulse fires. */
  next: number;
  /** When the last pulse fired. */
  start: number;
  /** Pulses fired. */
  fired: number;
}

export const createPulseClock = (): PulseClock => ({ t: 0, next: PULSE_FIRST_S, start: -Infinity, fired: 0 });

/**
 * Advances the clock by one frame. `on` is false with reduced motion, while the tab was hidden,
 * or with nothing to pulse: the clock then restarts, so the first pulse comes `PULSE_FIRST_S`
 * after it is back on and nothing is queued. Returns whether a pulse fired this frame and the
 * seconds since the current pulse began (-1 when none is running).
 */
export function tickPulse(c: PulseClock, dt: number, on: boolean): { fired: boolean; since: number } {
  if (!on) {
    c.t = 0;
    c.next = PULSE_FIRST_S;
    c.start = -Infinity;
    return { fired: false, since: -1 };
  }
  c.t += Math.min(Math.max(dt, 0), MAX_DT);
  let fired = false;
  if (c.t >= c.next) {
    c.start = c.t;
    c.next = c.t + PULSE_PERIOD_S;
    c.fired++;
    fired = true;
  }
  const since = c.t - c.start;
  return { fired, since: since <= PULSE_ACTIVE_S ? since : -1 };
}

/** Ease in and out (sine): the photons ease out of the label and into their ends. */
export const easePulse = (p: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, p)));

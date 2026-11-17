/**
 * The "photon pulse" that runs along the size lines. Pure TypeScript (no three.js, no React), in
 * crate-interior mm, so it is unit-tested directly. It stays in the viewer folder because it
 * only serves `DimensionLines` and `PhotonLayer`; the lines themselves are in `sizeLines.ts`.
 *
 * - `pulsePaths`: each dimension as a small graph (nodes at segment ends and junctions, the label
 *   anchor as the source), walked breadth-first into photon legs that split at every vertex.
 * - `tickPulse`: the 10 s clock that fires pulses.
 */
import type { Vec3 } from "@/domain/schema";
import type { Anchor, Seg, Where } from "./sizeLines";

/** Seconds from the crate first framing (the size lines mounting) to the first pulse. */
export const PULSE_FIRST_S = 2;
/** Seconds between pulses. */
export const PULSE_PERIOD_S = 10;
/** Seconds from the photons emerging to the last fade. */
export const PULSE_DURATION_S = 1.35;
/** Tail length as a share of the dimension line. */
export const PULSE_TAIL = 0.1;
/** Largest frame step the clock accepts, s; as `Director`, so a long gap never jumps ahead. */
const MAX_DT = 0.1;

/** One photon's run along one stretch between two graph nodes. */
export interface PhotonLeg {
  from: Vec3;
  to: Vec3;
  /** Path distance from the anchor at `from` and `to`, mm. */
  start: number;
  end: number;
}

export interface DimensionPulse {
  where: Where;
  anchor: Vec3;
  legs: PhotonLeg[];
  /** Longest path from the anchor to an end, mm. */
  total: number;
  /** Tail length, mm. */
  tail: number;
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
export function pulsePaths(segs: Seg[], label: Anchor, others: number[] = []): DimensionPulse {
  const { seg: dimIndex, at: anchor, where } = label;
  const dim = segs[dimIndex];
  const member = segs.filter((s, i) => i === dimIndex || (!others.includes(i) && (along(s, dim[0]) !== null || along(s, dim[1]) !== null)));

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
  const legs: PhotonLeg[] = [];
  const queue = [source];
  while (queue.length) {
    queue.sort((a, b) => reach[a] - reach[b]);
    const n = queue.shift()!;
    for (const m of adj[n]) {
      if (reach[m] !== Infinity) continue;
      reach[m] = reach[n] + dist(nodes[n], nodes[m]);
      legs.push({ from: nodes[n], to: nodes[m], start: reach[n], end: reach[m] });
      queue.push(m);
    }
  }

  const total = Math.max(EPS, ...legs.map((l) => l.end));
  return { where, anchor, legs, total, tail: PULSE_TAIL * dist(dim[0], dim[1]) };
}

/** Photon paths for every dimension, in anchor order (crate length, width, height, then the part). */
export function dimensionPulses(lines: Record<Where, Seg[]>, anchors: Anchor[]): DimensionPulse[] {
  return anchors.map((a) => {
    const others = anchors.filter((b) => b.where === a.where && b !== a).map((b) => b.seg);
    return pulsePaths(lines[a.where], a, others);
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
}

export const createPulseClock = (): PulseClock => ({ t: 0, next: PULSE_FIRST_S, start: -Infinity });

/**
 * Advances the clock by one frame. `on` is false with reduced motion or while the tab was
 * hidden: the clock then restarts, so the first pulse comes `PULSE_FIRST_S` after it is back on
 * and nothing is queued. Returns whether a pulse fired this frame and the seconds since the
 * current pulse began (-1 when none is running).
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
    fired = true;
  }
  const since = c.t - c.start;
  return { fired, since: since <= PULSE_DURATION_S ? since : -1 };
}

/** Ease in and out (sine): the photons ease out of the label and into their ends. */
export const easePulse = (p: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, p)));

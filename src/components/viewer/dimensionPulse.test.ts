import { describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { computeDesign, DEFAULT_SETTINGS } from "@/domain/design";
import type { Vec3 } from "@/domain/schema";
import {
  createPulseClock,
  dimensionPulses,
  pulsePaths,
  PULSE_DURATION_S,
  PULSE_FIRST_S,
  PULSE_PERIOD_S,
  tickPulse,
} from "./dimensionPulse";
import { buildLines, type Seg } from "./sizeLines";

function design(id = "PART-001", quantity = 4) {
  const d = computeDesign(getPart(id), { ...DEFAULT_SETTINGS, quantity }).design;
  if (!d) throw new Error("no design");
  return d;
}

const close = (a: Vec3, b: Vec3) => a.every((x, i) => Math.abs(x - b[i]) < 1e-6);
/** A leg is a leaf when no leg continues from where it ends: the photon fades there. */
const isLeaf = (p: ReturnType<typeof pulsePaths>, leg: ReturnType<typeof pulsePaths>["legs"][number]) => !p.legs.some((q) => q.from === leg.to);
const leaves = (p: ReturnType<typeof pulsePaths>) => p.legs.filter((l) => isLeaf(p, l));
const ends = (p: ReturnType<typeof pulsePaths>) => leaves(p).map((l) => l.to);

describe("pulsePaths (photon graph from a dimension's segments)", () => {
  const { lines, anchors } = buildLines(design(), true);
  const pulses = dimensionPulses(lines, anchors);
  const [L, W, H, ...part] = pulses;

  it("has one pulse per label: L, W, H on the crate, three on the part", () => {
    expect(pulses.map((p) => p.where)).toEqual(["front", "right", "right", "part", "part", "part"]);
    expect(part).toHaveLength(3);
  });

  it.each([
    ["length", () => L],
    ["width", () => W],
    ["height", () => H],
  ])("crate %s: 2 photons leave the label, each splits in 2 at its witness line → 6 branches, 4 ends", (_, get) => {
    const p = get();
    expect(p.legs).toHaveLength(6);
    expect(leaves(p)).toHaveLength(4);
    // The first two legs leave the anchor in opposite directions at time 0.
    const [a, b] = p.legs;
    expect(a.start).toBe(0);
    expect(b.start).toBe(0);
    expect(close(a.from, p.anchor) && close(b.from, p.anchor)).toBe(true);
    const da = a.to.map((x, i) => x - p.anchor[i]);
    const db = b.to.map((x, i) => x - p.anchor[i]);
    expect(da[0] * db[0] + da[1] * db[1] + da[2] * db[2]).toBeLessThan(0);
    // Every split leg starts where its parent ended; none goes back along a travelled segment.
    for (const leg of p.legs.slice(2)) expect(p.legs.some((q) => close(q.to, leg.from) && q.end === leg.start)).toBe(true);
  });

  it("the length photons end at both crate corners and both tick ends", () => {
    const [dim, extA, extB] = lines.front;
    const want = [extA[0], extA[1], extB[0], extB[1]];
    const got = ends(L);
    expect(got).toHaveLength(4);
    for (const w of want) expect(got.some((g) => close(g, w))).toBe(true);
    // The length line's own ends are split points, not ends.
    expect(got.some((g) => close(g, dim[0]) || close(g, dim[1]))).toBe(false);
  });

  it("the width photon doesn't run up the height line, nor the height photon along the width line", () => {
    const [wLine, , , hLine] = lines.right;
    const on = (s: Seg, x: Vec3) => close(s[0], x) || close(s[1], x);
    expect(W.legs.some((l) => on(hLine, l.from) && on(hLine, l.to))).toBe(false);
    expect(H.legs.some((l) => on(wLine, l.from) && on(wLine, l.to))).toBe(false);
  });

  it("a part line: 2 branches, 2 ends (its own segment ends; no witness lines)", () => {
    for (const p of part) {
      expect(p.legs).toHaveLength(2);
      expect(leaves(p)).toHaveLength(2);
    }
  });

  it("path distances add up: the furthest end is the pulse's total, each leg's length is its span", () => {
    for (const p of pulses) {
      expect(Math.max(...p.legs.map((l) => l.end))).toBeCloseTo(p.total, 9);
      for (const l of p.legs) expect(l.end - l.start).toBeCloseTo(Math.hypot(...l.to.map((x, i) => x - l.from[i])), 6);
    }
  });

  it("without the part dimensions there are only the three crate pulses", () => {
    const b = buildLines(design(), false);
    expect(dimensionPulses(b.lines, b.anchors)).toHaveLength(3);
  });
});

describe("tickPulse (the 10 s clock)", () => {
  const run = (clock: ReturnType<typeof createPulseClock>, seconds: number, on = true, dt = 1 / 60) => {
    let fired = 0;
    for (let t = 0; t < seconds - 1e-9; t += dt) if (tickPulse(clock, dt, on).fired) fired++;
    return fired;
  };

  it("first pulse about 2 s in, then every 10 s", () => {
    const c = createPulseClock();
    expect(run(c, PULSE_FIRST_S - 0.1)).toBe(0);
    expect(run(c, 0.2)).toBe(1);
    expect(run(c, PULSE_PERIOD_S - 0.2)).toBe(0);
    expect(run(c, 0.2)).toBe(1);
  });

  it("reports time into the pulse while it is running, -1 otherwise", () => {
    const c = createPulseClock();
    run(c, PULSE_FIRST_S + 0.5);
    const since = tickPulse(c, 0, true).since;
    expect(since).toBeGreaterThan(0.45);
    expect(since).toBeLessThan(0.55);
    run(c, PULSE_DURATION_S);
    expect(tickPulse(c, 0, true).since).toBe(-1);
  });

  it("never fires while off (reduced motion, labels off) and restarts the clock when back on", () => {
    const c = createPulseClock();
    expect(run(c, 30, false)).toBe(0);
    expect(run(c, PULSE_FIRST_S - 0.1)).toBe(0);
    expect(run(c, 0.2)).toBe(1);
  });

  it("a long frame gap (hidden tab) never queues a burst", () => {
    const c = createPulseClock();
    expect(run(c, PULSE_FIRST_S + 1)).toBe(1);
    // One huge delta, as when rAF resumes after the tab was hidden for a minute.
    expect(tickPulse(c, 60, true).fired).toBe(false);
    expect(run(c, 1)).toBe(0);
  });
});

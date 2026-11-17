/**
 * Orthographic drawings of a crate for the build sheet (#26): outside views (top, front, end)
 * and two sections through the load, projected from the design's members. Pure data in mm, so
 * the print page draws it as SVG and a later PDF export (#51) can draw the same thing.
 *
 * View coordinates: `x` to the right and `y` up, in mm. Every view is drawn with the crate as
 * seen from outside: top from above (front, −Y, at the bottom), front from −Y (+X to the
 * right), end from +X (+Y to the right).
 */
import { cradleSolidAt } from "@/domain/cradles";
import type { CrateDesign, Member } from "@/domain/crate";
import type { Vec3 } from "@/domain/schema";
import { cut, type Units } from "./units";

export type RectKind = "plywood" | "lumber" | "dunnage" | "part";

export interface DrawingRect {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: RectKind;
}

/** An overall dimension along the bottom edge (`below`) or the right edge (`right`) of the view. */
export interface DimLine {
  side: "below" | "right";
  /** Start and end along that edge, in view mm. */
  from: number;
  to: number;
  text: string;
}

export type DrawingId = "top" | "front" | "end" | "section-plan" | "section-side";

export interface Drawing {
  id: DrawingId;
  title: string;
  /** True for a section: the boards shown are cut through. */
  section: boolean;
  minX: number;
  minY: number;
  width: number;
  height: number;
  /** Back to front: later rects cover earlier ones. */
  rects: DrawingRect[];
  dims: DimLine[];
}

type Axis = 0 | 1 | 2;

interface View {
  u: Axis;
  v: Axis;
  depth: Axis;
  /** The viewer is on the +depth side (true) or the −depth side (false). */
  fromPlus: boolean;
}

const VIEWS: Record<"top" | "front" | "end", View> = {
  top: { u: 0, v: 1, depth: 2, fromPlus: true },
  front: { u: 0, v: 2, depth: 1, fromPlus: false },
  end: { u: 1, v: 2, depth: 0, fromPlus: true },
};

const memberKind = (m: Member): RectKind => (m.kind === "blocking" || m.kind === "bearer" || m.kind === "cradle" ? "dunnage" : m.material);

function rect(min: Vec3, size: Vec3, u: Axis, v: Axis, kind: RectKind): DrawingRect {
  return { x: min[u], y: min[v], w: size[u], h: size[v], kind };
}

function finish(id: DrawingId, title: string, section: boolean, rects: DrawingRect[], dims: (b: Bounds) => DimLine[]): Drawing {
  const b = bounds(rects);
  return { id, title, section, minX: b.minX, minY: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY, rects, dims: dims(b) };
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bounds(rects: DrawingRect[]): Bounds {
  if (!rects.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: Math.min(...rects.map((r) => r.x)),
    minY: Math.min(...rects.map((r) => r.y)),
    maxX: Math.max(...rects.map((r) => r.x + r.w)),
    maxY: Math.max(...rects.map((r) => r.y + r.h)),
  };
}

/** An outside view: every board, painted far to near. */
function outside(design: CrateDesign, id: "top" | "front" | "end", title: string, units: Units): Drawing {
  const { u, v, depth, fromPlus } = VIEWS[id];
  const near = (m: Member) => (fromPlus ? m.min[depth] + m.size[depth] : -m.min[depth]);
  const members = [...design.members].sort((a, b) => near(a) - near(b));
  const rects = members.map((m) => rect(m.min, m.size, u, v, memberKind(m)));
  return finish(id, title, false, rects, (b) => [
    { side: "below", from: b.minX, to: b.maxX, text: cut(b.maxX - b.minX, units) },
    { side: "right", from: b.minY, to: b.maxY, text: cut(b.maxY - b.minY, units) },
  ]);
}

/** The views and sections for one crate, in the order they are printed. */
export function crateDrawings(design: CrateDesign, units: Units): Drawing[] {
  const { layout, members } = design;
  const [a, b, c] = layout.cellSize;
  const [L, W, H] = layout.interior;
  const spans = (m: Member, axis: Axis, at: number) => m.min[axis] < at && at < m.min[axis] + m.size[axis];

  // Section A–A: a plan cut halfway up the bottom layer of parts.
  const bottom = layout.slots.filter((s) => s.index[2] === 0);
  const cutZ = (bottom[0]?.min[2] ?? 0) + c / 2;
  // Cradles (#6) sit under the parts, below the cut: drawn as seen beneath it.
  const cradled = members.some((m) => m.kind === "cradle");
  const below = (m: Member) => m.kind === "cradle" && m.min[2] + m.size[2] <= cutZ;
  const plan = [
    ...members.filter((m) => below(m)).map((m) => rect(m.min, m.size, 0, 1, memberKind(m))),
    ...members.filter((m) => spans(m, 2, cutZ)).map((m) => rect(m.min, m.size, 0, 1, memberKind(m))),
    ...bottom.map((s) => rect(s.min, [a, b, c], 0, 1, "part")),
  ];
  // Section B–B: a side cut through the middle of the front row of parts, every layer.
  const row = layout.slots.filter((s) => s.index[1] === 0);
  const cutY = (row[0]?.min[1] ?? 0) + b / 2;
  // The bearers under that row sit off the cut (at 20% and 80% of the part's width), so
  // they are drawn as seen beyond it.
  const rowY0 = row[0]?.min[1] ?? 0;
  const underRow = (m: Member) => m.kind === "bearer" && m.min[1] < rowY0 + b && m.min[1] + m.size[1] > rowY0 && !spans(m, 1, cutY);
  // A cradle cut through a notch shows only its solid part (below a top notch, above a bottom one).
  const sideRect = (m: Member): DrawingRect => {
    if (!m.cradle) return rect(m.min, m.size, 0, 2, memberKind(m));
    const [z0, z1] = cradleSolidAt(m, cutY);
    return rect([m.min[0], m.min[1], z0], [m.size[0], m.size[1], z1 - z0], 0, 2, memberKind(m));
  };
  const side = [
    ...members.filter((m) => spans(m, 1, cutY) || underRow(m)).map(sideRect),
    ...row.map((s) => rect(s.min, [a, b, c], 0, 2, "part")),
  ];
  const inside = (along: "below" | "right", size: number): DimLine => ({ side: along, from: 0, to: size, text: cut(size, units) });

  return [
    outside(design, "top", "Top", units),
    outside(design, "front", "Front", units),
    outside(design, "end", "End", units),
    finish(
      "section-plan",
      cradled ? "Section A–A: plan through the bottom layer, showing the cradles and end stops" : "Section A–A: plan through the bottom layer, showing the blocking",
      true,
      plan,
      () => [inside("below", L), inside("right", W)],
    ),
    finish(
      "section-side",
      cradled
        ? "Section B–B: side through the front row, showing the cradles, stacking cradles and end stops"
        : "Section B–B: side through the front row, showing bearers, blocking and separators",
      true,
      side,
      () => [
      inside("below", L),
      inside("right", H),
    ]),
  ];
}

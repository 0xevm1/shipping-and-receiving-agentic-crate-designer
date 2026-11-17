import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Spherical, Vector3 } from "three";
import { getPart } from "@/domain/catalog";
import { computeDesign, DEFAULT_SETTINGS } from "@/domain/design";
import { arrowReachMm } from "./forkArrows";
import {
  approach,
  ARROWS_FIT_FROM,
  keepCrateInFreeArea,
  panShift,
  PAN_TOLERANCE,
  projectCrate,
  fitGoal,
  freeArea,
  homeTarget,
  keepInView,
  LABEL_HALF_PX,
  MODE_ZOOM,
  PANELS_HIDDEN_ZOOM,
  PRESETS,
  shortestAngle,
  viewOffset,
  zoomMode,
  type FrameRequest,
} from "./framing";
import { domainToWorld, FOV_DEG, sceneOrigin } from "./scene";

function design(quantity = 4) {
  const d = computeDesign(getPart("PART-001"), { ...DEFAULT_SETTINGS, quantity }).design;
  if (!d) throw new Error("no design");
  return d;
}

const MODES = {
  closed: { lid: true, front: true, explode: 0 },
  open: { lid: false, front: false, explode: 0 },
  exploded: { lid: true, front: true, explode: 1 },
};
const NO_INSETS = { left: 0, top: 0, right: 0, bottom: 0 };

function request(over: Partial<FrameRequest> & { mode?: keyof typeof MODES } = {}): FrameRequest {
  const { mode = "closed", ...rest } = over;
  return {
    design: design(),
    view: { ...MODES[mode], camera: null, dims: true },
    panelsHidden: false,
    insets: NO_INSETS,
    width: 1440,
    height: 900,
    now: PRESETS.iso,
    keepHeading: false,
    ...rest,
  };
}

describe("zoomMode", () => {
  it("is the view's own mode, or the nearest one for a custom mix", () => {
    expect(zoomMode(MODES.closed)).toBe("closed");
    expect(zoomMode(MODES.open)).toBe("open");
    expect(zoomMode(MODES.exploded)).toBe("exploded");
    expect(zoomMode({ lid: true, front: true, explode: 0.7 })).toBe("exploded");
    expect(zoomMode({ lid: true, front: false, explode: 0.2 })).toBe("closed");
    expect(zoomMode({ lid: false, front: true, explode: 0.2 })).toBe("open");
  });
});

describe("fitGoal", () => {
  it("aims at the middle of the crate's height, above the floor", () => {
    const req = request();
    const g = fitGoal(req);
    expect(g.target.x).toBe(0);
    expect(g.target.y).toBeCloseTo(req.design.layout.external[2] / 2 / 1000, 6);
  });

  it("zooms in per mode, and further when the panels are hidden", () => {
    // Size labels off, so only the mode's zoom decides the distance.
    const plain = (mode: keyof typeof MODES, panelsHidden = false) =>
      fitGoal(request({ mode, panelsHidden, view: { ...MODES[mode], camera: null, dims: false } })).radius;
    expect(plain("closed")).toBeLessThan(plain("open"));
    expect(plain("open")).toBeLessThan(plain("exploded"));
    expect(plain("open", true)).toBeCloseTo(plain("open") * PANELS_HIDDEN_ZOOM, 6);
    expect(MODE_ZOOM.closed).toBeLessThan(MODE_ZOOM.exploded);
  });

  it("never comes in closer than its size labels allow", () => {
    const withLabels = fitGoal(request({ mode: "closed" })).radius;
    const without = fitGoal(request({ mode: "closed", view: { ...MODES.closed, camera: null, dims: false } })).radius;
    expect(withLabels).toBeGreaterThanOrEqual(without);
  });

  it("takes the preset's angles, or keeps the current ones with no preset", () => {
    const now = { theta: 1.2, phi: 0.9 };
    expect(fitGoal(request({ now })).theta).toBe(1.2);
    const top = fitGoal(request({ now, view: { ...MODES.closed, camera: "top", dims: true } }));
    expect(top.theta).toBe(PRESETS.top.theta);
    expect(top.phi).toBe(PRESETS.top.phi);
    // Auto-play turning the crate keeps its heading even with a preset set.
    expect(fitGoal(request({ now, keepHeading: true, view: { ...MODES.closed, camera: "end", dims: true } })).theta).toBe(1.2);
  });

  it("backs off for a narrower free area", () => {
    const wide = fitGoal(request({ width: 1440 })).radius;
    const narrow = fitGoal(request({ width: 360, height: 800 })).radius;
    expect(narrow).toBeGreaterThan(wide);
  });

  it.each([
    ["desktop, island on the right", 1440, 900, { left: 0, top: 0, right: 460, bottom: 90 }],
    ["360 px phone, summary bar below", 360, 800, { left: 0, top: 70, right: 0, bottom: 120 }],
    ["390 px phone", 390, 844, { left: 0, top: 70, right: 0, bottom: 120 }],
  ])("keeps every size label and fork arrow tail on screen, exploded (%s)", (_, width, height, insets) => {
    for (const mode of ["exploded", "open", "closed"] as const) {
      const req = request({ mode, width, height, insets });
      const g = fitGoal(req);
      const cam = new PerspectiveCamera(FOV_DEG, width / height, 0.02, 1000);
      const o = viewOffset(width, height, insets);
      cam.setViewOffset(width, height, o.x, o.y, width, height);
      cam.position.copy(g.target).add(new Vector3().setFromSpherical(new Spherical(g.radius, g.phi, g.theta)));
      cam.lookAt(g.target);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      const free = freeArea(width, height, insets);
      const origin = sceneOrigin(req.design);
      for (const { at, halfPx } of keepInView(req.design, req.view.explode)) {
        const p = domainToWorld([at[0] + origin[0], at[1] + origin[1], at[2] + origin[2]], new Vector3()).project(cam);
        const x = ((p.x + 1) / 2) * width;
        const y = ((1 - p.y) / 2) * height;
        const slack = 1.5;
        expect(x - halfPx.x, `${mode} x low`).toBeGreaterThanOrEqual(insets.left - slack);
        expect(x + halfPx.x, `${mode} x high`).toBeLessThanOrEqual(width - insets.right + slack);
        expect(y - halfPx.y, `${mode} y low`).toBeGreaterThanOrEqual(insets.top - slack);
        expect(y + halfPx.y, `${mode} y high`).toBeLessThanOrEqual(height - insets.bottom + slack);
        expect(free.fw).toBeGreaterThan(0);
      }
    }
  });
});

describe("keepInView", () => {
  const d = design();

  it("assembled, only the three crate labels", () => {
    const keep = keepInView(d, 0);
    expect(keep).toHaveLength(3);
    expect(keepInView(d, ARROWS_FIT_FROM - 0.01)).toHaveLength(3);
  });

  it("exploded: the three labels, then both fork arrow tails for each opening", () => {
    const keep = keepInView(d, 1);
    expect(keep).toHaveLength(3 + 2 * d.handling.openings.length);
    expect(keep.slice(0, 3).every((k) => k.halfPx === LABEL_HALF_PX)).toBe(true);
    const tails = keep.slice(3).map((k) => k.at[0]);
    const reach = arrowReachMm(d.layout.external);
    // The -X tail: outside the end face, reach further, and out with the wall.
    expect(Math.min(...tails)).toBeCloseTo(-(d.construction.panelMm + d.construction.cleat.thick) - reach - 320, 6);
  });

  it("the arrow tails slide out with the end walls when exploded", () => {
    const [a, b] = [keepInView(d, 0.5), keepInView(d, 1)];
    const i = a.length - 1;
    expect(b[i].at[0] - a[i].at[0]).toBeCloseTo(160, 9);
  });
});

describe("helpers", () => {
  it("approach eases toward the target and snaps when close", () => {
    expect(approach(0, 10, 0.5, 0.01)).toBe(5);
    expect(approach(9.999, 10, 0.5, 0.01)).toBe(10);
  });

  it("shortestAngle takes the short way round", () => {
    expect(shortestAngle(0.1, 0.3)).toBeCloseTo(0.2);
    expect(shortestAngle(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(shortestAngle(-3, 3)).toBeCloseTo(6 - 2 * Math.PI);
  });

  it("the view offset centres the projection on the free area", () => {
    expect(viewOffset(1000, 800, NO_INSETS)).toEqual({ x: -0, y: -0 });
    expect(viewOffset(1000, 800, { left: 0, top: 0, right: 400, bottom: 0 }).x).toBe(200);
  });
});

describe("panning stays in the free area", () => {
  const d = design();
  const free = { left: 40, top: 96, right: 980, bottom: 770 };

  it("panShift leaves a box inside the free area alone", () => {
    expect(panShift({ left: 100, top: 150, right: 600, bottom: 600 }, free)).toEqual({ dx: 0, dy: 0 });
  });

  it("panShift moves a small box that strayed back inside (give or take the tolerance), on each side", () => {
    const tol = PAN_TOLERANCE * (free.right - free.left);
    const right = panShift({ left: 900, top: 200, right: 1200, bottom: 500 }, free);
    expect(900 + right.dx + 300).toBeCloseTo(free.right + tol, 9);
    const left = panShift({ left: -300, top: 200, right: -50, bottom: 500 }, free);
    expect(-300 + left.dx).toBeCloseTo(free.left - tol, 9);
    const below = panShift({ left: 200, top: 700, right: 400, bottom: 900 }, free);
    expect(below.dy).toBeLessThan(0);
    expect(below.dx).toBe(0);
  });

  it("panShift puts a box bigger than the free area on its middle half", () => {
    const wide = { left: -2000, top: 200, right: -500, bottom: 500 };
    const { dx } = panShift(wide, free);
    const mid = (wide.left + wide.right) / 2 + dx;
    expect(mid).toBeCloseTo((free.left + free.right) / 2 - (free.right - free.left) / 4, 9);
  });

  const W = 1440;
  const H = 900;
  const insets = { left: 40, top: 96, right: 460, bottom: 130 };

  function framed() {
    const g = fitGoal(request({ width: W, height: H, insets }));
    const cam = new PerspectiveCamera(FOV_DEG, W / H, 0.02, 1000);
    const o = viewOffset(W, H, insets);
    cam.setViewOffset(W, H, o.x, o.y, W, H);
    cam.position.copy(g.target).add(new Vector3().setFromSpherical(new Spherical(g.radius, g.phi, g.theta)));
    cam.lookAt(g.target);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    return { cam, target: g.target.clone() };
  }

  it("the framed crate is already inside the free area, so nothing moves", () => {
    const { cam, target } = framed();
    expect(keepCrateInFreeArea(d, cam, target, { width: W, height: H }, insets)).toBe(false);
  });

  it.each([
    ["right, toward the island", 1, 0],
    ["left", -1, 0],
    ["up", 0, 1],
    ["down", 0, -1],
  ])("however far it is panned %s, the crate's box is brought back inside", (_, sx, sy) => {
    const { cam, target } = framed();
    // Pan by metres in the view plane, as a drag does: camera and target move together.
    const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const move = right.multiplyScalar(-sx * 6).addScaledVector(up, -sy * 6);
    cam.position.add(move);
    target.add(move);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    const size = { width: W, height: H };
    expect(keepCrateInFreeArea(d, cam, target, size, insets)).toBe(true);
    const box = projectCrate(d, cam, W, H);
    const tolX = PAN_TOLERANCE * (W - insets.left - insets.right) + 2;
    const tolY = PAN_TOLERANCE * (H - insets.top - insets.bottom) + 2;
    expect(box.right).toBeLessThanOrEqual(W - insets.right + tolX);
    expect(box.left).toBeGreaterThanOrEqual(insets.left - tolX);
    expect(box.top).toBeGreaterThanOrEqual(insets.top - tolY);
    expect(box.bottom).toBeLessThanOrEqual(H - insets.bottom + tolY);
  });

  it("measures home from the middle of the exploded crate when it is exploded", () => {
    expect(homeTarget(d, 1).y).toBeGreaterThan(homeTarget(d, 0).y);
  });
});

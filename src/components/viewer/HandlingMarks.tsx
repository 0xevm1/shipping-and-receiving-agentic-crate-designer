"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Box2, CircleGeometry, DoubleSide, MathUtils, MeshBasicMaterial, Shape, ShapeGeometry, Vector2, Vector3, type Group, type Mesh } from "three";
import type { CrateDesign } from "@/domain/crate";
import type { Vec3 } from "@/domain/schema";
import { anim } from "@/state/motion";
import { useView } from "@/state/viewStore";
import { approach, LABEL_HALF_PX } from "./framing";
import {
  arrowFreeRect,
  arrowGapMm,
  arrowHeadMm,
  arrowLengthMm,
  arrowOutline,
  arrowSamples,
  arrowWidthMm,
  crateXRange,
  layoutArrows,
  nextHidden,
  occludedShare,
  type ArrowLayout,
  type Box,
} from "./forkArrows";
import { crateLabelAnchors } from "./sizeLines";
import { PROBE, probeStats } from "./probeStats";
import { EXPLODE_WALL_MM, explodeOffset } from "./scene";

/** The brand gold (`--gold`), so the entry arrows read apart from the pale size lines. */
const ARROW = "#f3a000";
/** Stencils sit this far off the outside faces, so they never z-fight with the boards, mm. */
const STENCIL_GAP_MM = 3;
/** Opacity of a shown fork arrow, and how fast (1/s) one fades in or out as the crate hides it. */
const ARROW_ALPHA = 0.85;
const ARROW_FADE_RATE = 10;
const noRaycast = () => null;

/** Arrow pointing +X in the XY plane, tip at the origin. */
function arrowShape(length: number, width: number): Shape {
  const head = arrowHeadMm(length, width);
  const shaft = width * 0.4;
  const s = new Shape();
  s.moveTo(0, 0);
  s.lineTo(-head, width / 2);
  s.lineTo(-head, shaft / 2);
  s.lineTo(-length, shaft / 2);
  s.lineTo(-length, -shaft / 2);
  s.lineTo(-head, -shaft / 2);
  s.lineTo(-head, -width / 2);
  s.closePath();
  return s;
}

/** Where the CoG stencil goes on each outside face, and which way that face points. */
type Face = "side-" | "side+" | "end-" | "end+";
const FACES: readonly Face[] = ["side-", "side+", "end-", "end+"];
const ENDS = ["minus", "plus"] as const;

const eye = new Vector3();
const spot = new Vector3();
/** How fast (1/s) an arrow's length follows the length the free area allows it. */
const ARROW_SCALE_RATE = 14;

/**
 * Centre of gravity and fork entry (spec §8.4), in crate-interior mm, shown with the size
 * labels:
 * - the CoG, **only when it matters**: when the `cog-offset` or `cog-tip` check is a caution. It
 *   is drawn as a real crate marking would be: a flat quartered black-and-white circle (the
 *   ISO 7000-0627 mark) stencilled on each outside face, at the CoG's position along that face
 *   and its height. A centred, low CoG gets no marker; the label and Checks still give it.
 * - flat arrows on the ground at both ends, one per opening between the skids, pointing in. An
 *   end the crate hides from the current camera (mostly behind it) drops its arrows, fading,
 *   rather than leaving a sliver of yellow poking out.
 *
 * Pure decoration: they can't be hovered or clicked (no raycast), have no handlers and never
 * call `markInput`, so they never count as input. The stencils move out with their walls and the
 * arrows with the end walls when exploded, as the dimension lines do.
 */
export function HandlingMarks({ design }: { design: CrateDesign }) {
  const { handling, layout } = design;
  const cog = handling.cogMm;
  const root = useRef<Group>(null);
  const ends = useRef<(Group | null)[]>([null, null]);
  const nearArrow = useRef<Mesh>(null);
  const faceRefs = useRef<Partial<Record<Face, Group | null>>>({});
  /** Per end (−X, +X): whether the crate hides it now. */
  const hidden = useRef([false, false]);
  /** The camera and explode amount the ends were last judged at; NaN until the first frame. */
  const judged = useRef({ x: NaN, y: NaN, z: NaN, e: NaN });
  /** Each end's arrow meshes, and for each whether it is dropped for lack of room in the free area. */
  const meshes = useRef<(Mesh | null)[][]>([[], []]);
  const dropped = useRef<boolean[][]>([[], []]);

  const lo = [0, 1, 2].map((i) => Math.min(...design.members.map((m) => m.min[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...design.members.map((m) => m.min[i] + m.size[i])));
  const [x0, x1] = crateXRange(design);
  const ground = handling.groundZ;
  const radius = Math.max(40, Math.min(90, 0.07 * Math.min(layout.external[1], layout.external[2])));
  const showCog = design.checks.some((c) => (c.id === "cog-offset" || c.id === "cog-tip") && c.level === "caution");

  const { quarters, black, white } = useMemo(() => {
    // A flat disc in four quarters, alternating black and white: the ISO 7000-0627 mark.
    const quarters = Array.from({ length: 4 }, (_, i) => ({
      geometry: new CircleGeometry(radius, 16, i * (Math.PI / 2), Math.PI / 2),
      dark: i % 2 === 0,
    }));
    const black = new MeshBasicMaterial({ color: "#111", side: DoubleSide });
    const white = new MeshBasicMaterial({ color: "#f4f4f4", side: DoubleSide });
    return { quarters, black, white };
  }, [radius]);

  // Each face's stencil: the CoG projected onto that outside face, turned to face outwards.
  const stencils: { face: Face; position: Vec3; rotation: Vec3 }[] = [
    { face: "side-", position: [cog[0], lo[1] - STENCIL_GAP_MM, cog[2]], rotation: [Math.PI / 2, 0, 0] },
    { face: "side+", position: [cog[0], hi[1] + STENCIL_GAP_MM, cog[2]], rotation: [-Math.PI / 2, 0, 0] },
    { face: "end-", position: [lo[0] - STENCIL_GAP_MM, cog[1], cog[2]], rotation: [0, -Math.PI / 2, 0] },
    { face: "end+", position: [hi[0] + STENCIL_GAP_MM, cog[1], cog[2]], rotation: [0, Math.PI / 2, 0] },
  ];

  const length = arrowLengthMm(layout.external);
  const gap = arrowGapMm(layout.external);
  const arrows = useMemo(
    () =>
      handling.openings.map((o) => {
        const width = arrowWidthMm(o.width);
        return { y: o.y + o.width / 2, width, geometry: new ShapeGeometry(arrowShape(length, width)) };
      }),
    [handling.openings, length],
  );
  // One material per end, so each fades on its own.
  const arrowMats = useMemo(
    () => ENDS.map(() => new MeshBasicMaterial({ color: ARROW, transparent: true, opacity: ARROW_ALPHA, side: DoubleSide, depthWrite: false })),
    [],
  );

  useEffect(() => {
    if (!PROBE) return;
    probeStats.handling.cog = showCog ? [cog[0], cog[1], cog[2]] : null;
    probeStats.handling.arrows = arrows.length * 2;
    return () => {
      probeStats.handling.cog = null;
      probeStats.handling.arrows = 0;
      probeStats.handling.arrowsShown = 0;
      probeStats.handling.endsShown = [true, true];
      probeStats.handling.arrowBox = null;
      probeStats.handling.arrowBoxes = [];
    };
  }, [cog, arrows, showCog]);

  useEffect(
    () => () => {
      quarters.forEach((q) => q.geometry.dispose());
      black.dispose();
      white.dispose();
    },
    [quarters, black, white],
  );
  useEffect(
    () => () => {
      arrows.forEach((a) => a.geometry.dispose());
    },
    [arrows],
  );
  useEffect(() => () => arrowMats.forEach((m) => m.dispose()), [arrowMats]);

  /** The width label's anchor with the walls closed; it slides out with the +X end when exploded. */
  const widthLabel = useMemo(() => crateLabelAnchors(design, 0)[1], [design]);

  useFrame(({ camera, size }, dt) => {
    const out = EXPLODE_WALL_MM * anim.explode;
    ends.current[0]?.position.set(-out, 0, 0);
    ends.current[1]?.position.set(out, 0, 0);
    for (const face of FACES) faceRefs.current[face]?.position.set(...explodeOffset(face, anim.explode));

    // Where each arrow stands and how much of it fits: its tip just clear of the width label on screen
    // (not always the worst-case gap), scaled down to stay inside the free area, none at all when
    // there is no room. The crate's framing is left as it was.
    let placed: ArrowLayout[] = [];
    let project: ((p: Vec3) => readonly [number, number]) | null = null;
    if (root.current && arrows.length) {
      camera.updateMatrixWorld();
      project = (p: Vec3) => {
        spot.set(p[0], p[1], p[2]);
        root.current!.localToWorld(spot).project(camera);
        return [((spot.x + 1) / 2) * size.width, ((1 - spot.y) / 2) * size.height] as const;
      };
      const free = arrowFreeRect(useView.getState().insets, size.width, size.height);
      const label = { at: [widthLabel[0] + out, widthLabel[1], widthLabel[2]] as Vec3, halfPx: LABEL_HALF_PX };
      placed = layoutArrows(design, out, project, free, label, dropped.current);
    }

    // Is an end's arrow mostly behind the crate? Judged again only when the camera or the explode moved.
    let snap = false;
    if (root.current && arrows.length) {
      root.current.worldToLocal(eye.copy(camera.position));
      const j = judged.current;
      if (eye.x !== j.x || eye.y !== j.y || eye.z !== j.z || anim.explode !== j.e) {
        snap = Number.isNaN(j.x);
        judged.current = { x: eye.x, y: eye.y, z: eye.z, e: anim.explode };
        // The crate as an occluder: a box, whose top drops to the floor as it explodes.
        const box: Box = { min: [lo[0], lo[1], lo[2]], max: [hi[0], hi[1], MathUtils.lerp(hi[2], 0, anim.explode)] };
        const from: Vec3 = [eye.x, eye.y, eye.z];
        ENDS.forEach((_, i) => {
          const samples = placed.filter((l) => l.end === i).flatMap((l) => arrowSamples(l.tip, l.outward, l.length, l.width));
          hidden.current[i] = nextHidden(hidden.current[i], occludedShare(from, samples, box));
        });
      }
    }
    // Fade each end toward its target; the first judgement snaps, so a hidden end is never drawn.
    const k = snap ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * ARROW_FADE_RATE);
    let shown = 0;
    ENDS.forEach((_, i) => {
      const m = arrowMats[i];
      const target = hidden.current[i] ? 0 : ARROW_ALPHA;
      m.opacity = Math.abs(target - m.opacity) < 0.01 ? target : m.opacity + (target - m.opacity) * k;
      const g = ends.current[i];
      if (g) g.visible = m.opacity > 0.01;
      if (target > 0) shown += arrows.length;
    });

    // Apply the layout: each arrow's gap and size (the size follows its target quickly, so one
    // squeezed by the camera turning doesn't pop).
    const arrowBoxes: { left: number; top: number; right: number; bottom: number }[] = [];
    const kScale = snap ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * ARROW_SCALE_RATE);
    for (const l of placed) {
      const mesh = meshes.current[l.end][l.index];
      if (!mesh) continue;
      mesh.position.x = (l.end === 0 ? x0 : x1) + l.outward * l.gap;
      dropped.current[l.end][l.index] = l.scale === 0;
      const s = approach(mesh.scale.x, l.scale, kScale, 0.01);
      mesh.scale.set(s, s, 1);
      mesh.visible = s > 0.02;
      if (PROBE && project && mesh.visible && !hidden.current[l.end]) {
        const box = new Box2();
        for (const p of arrowOutline(l.tip, l.outward, l.length, l.width, mesh.scale.x)) box.expandByPoint(new Vector2(...project(p)));
        arrowBoxes.push({ left: box.min.x, top: box.min.y, right: box.max.x, bottom: box.max.y });
      }
    }

    if (PROBE) {
      probeStats.handling.arrowBoxes = arrowBoxes;
      probeStats.handling.arrowsShown = shown;
      probeStats.handling.endsShown = [!hidden.current[0], !hidden.current[1]];
      if (nearArrow.current && arrows[0]) {
        // Where the near-end arrow lands on screen, to check it clears the width label.
        nearArrow.current.updateWorldMatrix(true, false);
        const box = new Box2();
        const bounds = arrows[0].geometry.boundingBox ?? (arrows[0].geometry.computeBoundingBox(), arrows[0].geometry.boundingBox!);
        for (const x of [bounds.min.x, bounds.max.x])
          for (const y of [bounds.min.y, bounds.max.y]) {
            const p = new Vector3(x, y, 0).applyMatrix4(nearArrow.current.matrixWorld).project(camera);
            box.expandByPoint(new Vector2(((p.x + 1) / 2) * size.width, ((1 - p.y) / 2) * size.height));
          }
        probeStats.handling.arrowBox = { left: box.min.x, top: box.min.y, right: box.max.x, bottom: box.max.y };
      }
    }
  });

  // Just above the ground so the arrows never z-fight with the floor grid.
  const z = ground + 2;
  return (
    <group ref={root}>
      {showCog &&
        stencils.map(({ face, position, rotation }) => (
          <group
            key={face}
            ref={(g) => {
              faceRefs.current[face] = g;
            }}
          >
            <group position={position} rotation={rotation}>
              {quarters.map((q, i) => (
                <mesh key={i} geometry={q.geometry} material={q.dark ? black : white} renderOrder={11} raycast={noRaycast} />
              ))}
            </group>
          </group>
        ))}
      <group
        ref={(g) => {
          ends.current[0] = g;
        }}
      >
        {arrows.map((a, i) => (
          <mesh
            key={i}
            ref={(m) => {
              meshes.current[0][i] = m;
            }}
            geometry={a.geometry}
            material={arrowMats[0]}
            position={[x0 - gap, a.y, z]}
            renderOrder={11}
            raycast={noRaycast}
          />
        ))}
      </group>
      <group
        ref={(g) => {
          ends.current[1] = g;
        }}
      >
        {arrows.map((a, i) => (
          <mesh
            key={i}
            ref={(m) => {
              meshes.current[1][i] = m;
              if (i === 0) nearArrow.current = m;
            }}
            geometry={a.geometry}
            material={arrowMats[1]}
            position={[x1 + gap, a.y, z]}
            rotation={[0, 0, Math.PI]}
            renderOrder={11}
            raycast={noRaycast}
          />
        ))}
      </group>
    </group>
  );
}

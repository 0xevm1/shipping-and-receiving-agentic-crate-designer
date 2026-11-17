"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Box2, CircleGeometry, DoubleSide, MeshBasicMaterial, Shape, ShapeGeometry, Vector2, Vector3, type Group, type Mesh } from "three";
import type { CrateDesign } from "@/domain/crate";
import type { Vec3 } from "@/domain/schema";
import { anim } from "@/state/motion";
import { EXPLODE_WALL_MM, explodeOffset } from "./scene";

/** The brand gold (`--gold`), so the entry arrows read apart from the pale size lines. */
const ARROW = "#f3a000";
/** Stencils sit this far off the outside faces, so they never z-fight with the boards, mm. */
const STENCIL_GAP_MM = 3;
/**
 * How far outside the end the arrow's tip stops, mm. The width size label sits on the same
 * centre line, `110 + 5 %` of the longest side beyond the end (`buildLines`), and a label is a
 * fixed-size pill over a crate that scales to fit, so it covers about a third of that side in
 * mm. The tip starts beyond both (#62), so the arrow and the "25.7 in" label never overlap.
 */
export function arrowGapMm(external: readonly number[]): number {
  const longest = Math.max(...external);
  return 110 + 0.05 * longest + 0.33 * longest + 60;
}
const noRaycast = () => null;

/**
 * What the handling marks drew, for the e2e test hook (#8). `cog` is the CoG the stencils mark,
 * or null when none are drawn (#87). Written on mount, never read by the scene.
 */
export const handlingMarks = {
  cog: null as Vec3 | null,
  arrows: 0,
  /** The near-end arrow's screen box, CSS px (only measured in `NEXT_PUBLIC_E2E` builds, #62). */
  arrowBox: null as { left: number; top: number; right: number; bottom: number } | null,
};

/** Arrow pointing +X in the XY plane, tip at the origin. */
function arrowShape(length: number, width: number): Shape {
  const head = Math.min(length * 0.45, width * 1.2);
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

/**
 * Centre of gravity and fork entry (#8, spec §8.4), in crate-interior mm, shown with the size
 * labels:
 * - the CoG, **only when it matters** (#87): when the `cog-offset` or `cog-tip` check is a
 *   caution. It is drawn as a real crate marking would be: a flat quartered black-and-white circle
 *   (the ISO 7000-0627 mark) stencilled on each outside face, at the CoG's position along that
 *   face and its height. A centred, low CoG gets no marker; the label and Checks still give it.
 * - flat arrows on the ground at both ends, one per opening between the skids, pointing in.
 *
 * Pure decoration: they can't be hovered or clicked (no raycast), have no handlers and never
 * call `markInput`, so they never count as input (#64). The stencils move out with their walls
 * and the arrows with the end walls when exploded, as the dimension lines do.
 */
export function HandlingMarks({ design }: { design: CrateDesign }) {
  const { handling, layout } = design;
  const cog = handling.cogMm;
  const minus = useRef<Group>(null);
  const plus = useRef<Group>(null);
  const nearArrow = useRef<Mesh>(null);
  const faceRefs = useRef<Partial<Record<Face, Group | null>>>({});

  const lo = [0, 1, 2].map((i) => Math.min(...design.members.map((m) => m.min[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...design.members.map((m) => m.min[i] + m.size[i])));
  const [x0, x1] = [lo[0], hi[0]];
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

  const arrows = useMemo(() => {
    const out = handling.openings.map((o) => {
      const width = Math.min(o.width * 0.7, 220);
      const length = Math.min(320, Math.max(180, 0.17 * layout.external[0]));
      return { y: o.y + o.width / 2, geometry: new ShapeGeometry(arrowShape(length, width)) };
    });
    return out;
  }, [handling.openings, layout.external]);
  const arrowMat = useMemo(() => new MeshBasicMaterial({ color: ARROW, transparent: true, opacity: 0.85, side: DoubleSide, depthWrite: false }), []);

  useEffect(() => {
    handlingMarks.cog = showCog ? [cog[0], cog[1], cog[2]] : null;
    handlingMarks.arrows = arrows.length * 2;
    return () => {
      handlingMarks.cog = null;
      handlingMarks.arrows = 0;
      handlingMarks.arrowBox = null;
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
      arrowMat.dispose();
    },
    [arrows, arrowMat],
  );

  useFrame(({ camera, size }) => {
    if (process.env.NEXT_PUBLIC_E2E && nearArrow.current && arrows[0]) {
      // Test hook: where the near-end arrow lands on screen, to check it clears the width label.
      nearArrow.current.updateWorldMatrix(true, false);
      const box = new Box2();
      const bounds = arrows[0].geometry.boundingBox ?? (arrows[0].geometry.computeBoundingBox(), arrows[0].geometry.boundingBox!);
      for (const x of [bounds.min.x, bounds.max.x])
        for (const y of [bounds.min.y, bounds.max.y]) {
          const p = new Vector3(x, y, 0).applyMatrix4(nearArrow.current.matrixWorld).project(camera);
          box.expandByPoint(new Vector2(((p.x + 1) / 2) * size.width, ((1 - p.y) / 2) * size.height));
        }
      handlingMarks.arrowBox = { left: box.min.x, top: box.min.y, right: box.max.x, bottom: box.max.y };
    }
    const out = EXPLODE_WALL_MM * anim.explode;
    minus.current?.position.set(-out, 0, 0);
    plus.current?.position.set(out, 0, 0);
    for (const face of ["side-", "side+", "end-", "end+"] as const) faceRefs.current[face]?.position.set(...explodeOffset(face, anim.explode));
  });

  // Just above the ground so the arrows never z-fight with the floor grid.
  const z = ground + 2;
  const gap = arrowGapMm(layout.external);
  return (
    <group>
      {showCog &&
        stencils.map(({ face, position, rotation }) => (
          <group key={face} ref={(g) => void (faceRefs.current[face] = g)}>
            <group position={position} rotation={rotation}>
              {quarters.map((q, i) => (
                <mesh key={i} geometry={q.geometry} material={q.dark ? black : white} renderOrder={11} raycast={noRaycast} />
              ))}
            </group>
          </group>
        ))}
      <group ref={minus}>
        {arrows.map((a, i) => (
          <mesh key={i} geometry={a.geometry} material={arrowMat} position={[x0 - gap, a.y, z]} renderOrder={11} raycast={noRaycast} />
        ))}
      </group>
      <group ref={plus}>
        {arrows.map((a, i) => (
          <mesh
            key={i}
            ref={i === 0 ? nearArrow : undefined}
            geometry={a.geometry}
            material={arrowMat}
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

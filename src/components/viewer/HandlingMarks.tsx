"use client";

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { DoubleSide, MeshBasicMaterial, Shape, ShapeGeometry, SphereGeometry, type Group } from "three";
import type { CrateDesign } from "@/domain/crate";
import type { Vec3 } from "@/domain/schema";
import { anim } from "@/state/motion";
import { EXPLODE_WALL_MM } from "./scene";

/** The brand gold (`--gold`), so the entry arrows read apart from the pale size lines. */
const ARROW = "#f3a000";
const DROP = "#e6eef7";
/** How far outside the end the arrow's tip stops, mm. */
const ARROW_GAP_MM = 60;
const noRaycast = () => null;

/**
 * What the handling marks drew, for the e2e test hook (#8). Written on mount, never read by the
 * scene.
 */
export const handlingMarks = { cog: null as Vec3 | null, arrows: 0 };

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

/**
 * Centre of gravity and fork entry (#8, spec §8.4), in crate-interior mm, shown with the size
 * labels:
 * - the CoG as a quartered black-and-white ball (the ISO 7000-0627 mark, seen from any side) with
 *   a drop line to the ground, drawn through the walls like the size lines;
 * - flat arrows on the ground at both ends, one per opening between the skids, pointing in.
 *
 * Pure decoration: they can't be hovered or clicked (no raycast), have no handlers and never
 * call `markInput`, so they never count as input (#64). The arrows slide out with the end walls
 * when exploded, as the dimension lines do; the CoG belongs to the assembled crate and stays put.
 */
export function HandlingMarks({ design }: { design: CrateDesign }) {
  const { handling, layout } = design;
  const cog = handling.cogMm;
  const minus = useRef<Group>(null);
  const plus = useRef<Group>(null);

  const x0 = Math.min(...design.members.map((m) => m.min[0]));
  const x1 = Math.max(...design.members.map((m) => m.min[0] + m.size[0]));
  const ground = handling.groundZ;
  const radius = Math.max(18, Math.min(45, 0.035 * Math.max(...layout.external)));

  const { octants, black, white } = useMemo(() => {
    // Eight octants, alternating, so every view shows the quartered circle.
    const octants = Array.from({ length: 8 }, (_, i) => ({
      geometry: new SphereGeometry(radius, 12, 6, (i % 4) * (Math.PI / 2), Math.PI / 2, i < 4 ? 0 : Math.PI / 2, Math.PI / 2),
      dark: (i + (i < 4 ? 0 : 1)) % 2 === 0,
    }));
    const black = new MeshBasicMaterial({ color: "#111", depthTest: false, transparent: true });
    const white = new MeshBasicMaterial({ color: "#fff", depthTest: false, transparent: true });
    return { octants, black, white };
  }, [radius]);

  const arrows = useMemo(() => {
    const out = handling.openings.map((o) => {
      const width = Math.min(o.width * 0.7, 220);
      const length = Math.min(600, Math.max(250, 0.3 * layout.external[0]));
      return { y: o.y + o.width / 2, geometry: new ShapeGeometry(arrowShape(length, width)) };
    });
    return out;
  }, [handling.openings, layout.external]);
  const arrowMat = useMemo(() => new MeshBasicMaterial({ color: ARROW, transparent: true, opacity: 0.85, side: DoubleSide, depthWrite: false }), []);

  useEffect(() => {
    handlingMarks.cog = [cog[0], cog[1], cog[2]];
    handlingMarks.arrows = arrows.length * 2;
    return () => {
      handlingMarks.cog = null;
      handlingMarks.arrows = 0;
    };
  }, [cog, arrows]);

  useEffect(
    () => () => {
      octants.forEach((o) => o.geometry.dispose());
      black.dispose();
      white.dispose();
    },
    [octants, black, white],
  );
  useEffect(
    () => () => {
      arrows.forEach((a) => a.geometry.dispose());
      arrowMat.dispose();
    },
    [arrows, arrowMat],
  );

  useFrame(() => {
    const out = EXPLODE_WALL_MM * anim.explode;
    minus.current?.position.set(-out, 0, 0);
    plus.current?.position.set(out, 0, 0);
  });

  // Just above the ground so the arrows never z-fight with the floor grid.
  const z = ground + 2;
  return (
    <group>
      <group position={cog}>
        {octants.map((o, i) => (
          <mesh key={i} geometry={o.geometry} material={o.dark ? black : white} renderOrder={12} raycast={noRaycast} />
        ))}
      </group>
      <Line
        points={[cog, [cog[0], cog[1], ground]]}
        color={DROP}
        lineWidth={1}
        dashed
        dashSize={18}
        gapSize={12}
        transparent
        opacity={0.6}
        depthTest={false}
        renderOrder={11}
        raycast={noRaycast}
      />
      <group ref={minus}>
        {arrows.map((a, i) => (
          <mesh key={i} geometry={a.geometry} material={arrowMat} position={[x0 - ARROW_GAP_MM, a.y, z]} renderOrder={11} raycast={noRaycast} />
        ))}
      </group>
      <group ref={plus}>
        {arrows.map((a, i) => (
          <mesh
            key={i}
            geometry={a.geometry}
            material={arrowMat}
            position={[x1 + ARROW_GAP_MM, a.y, z]}
            rotation={[0, 0, Math.PI]}
            renderOrder={11}
            raycast={noRaycast}
          />
        ))}
      </group>
    </group>
  );
}

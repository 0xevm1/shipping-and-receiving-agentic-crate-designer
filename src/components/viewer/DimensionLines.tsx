"use client";

import { Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Vector3, type Group } from "three";
import type { CrateDesign } from "@/domain/crate";
import type { Vec3 } from "@/domain/schema";
import { length, lengthUnit, type Units } from "@/lib/units";
import { anim } from "@/state/motion";
import { useDesigner } from "@/state/store";
import { EXPLODE_WALL_MM } from "./scene";
import { labelElements } from "./SizeLabels";

const LINE = "#e6eef7";
const PART_LINE = "#70b8fd";

type Seg = [Vec3, Vec3];
type Where = "front" | "right" | "part";
interface Anchor {
  at: Vec3;
  value: number;
  where: Where;
}

const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const v = new Vector3();

/**
 * Size lines, in crate-interior mm. Crate: length along the front bottom edge,
 * width along the right bottom edge, height at the back right corner. They
 * slide out with the walls when exploded but keep the assembled numbers.
 * Part: one part (top layer, front row, rightmost) in ice blue, only once the
 * inside is on show. Lines skip depth testing so they are never buried; the
 * labels are DOM elements (see SizeLabels) positioned here every frame.
 */
export function DimensionLines({ design, units, showParts }: { design: CrateDesign; units: Units; showParts: boolean }) {
  const frontRef = useRef<Group>(null);
  const rightRef = useRef<Group>(null);
  const partRef = useRef<Group>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const setLabels = useDesigner((s) => s.setLabels);
  const [insideShown, setInsideShown] = useState(false);

  const { lines, anchors } = useMemo(() => buildLines(design, showParts && insideShown), [design, showParts, insideShown]);

  useEffect(() => {
    setLabels(anchors.map((a) => ({ text: `${length(a.value, units)} ${lengthUnit(units)}`, inner: a.where === "part" })));
  }, [anchors, units, setLabels]);
  useEffect(() => () => setLabels([]), [setLabels]);

  useFrame(() => {
    const out = EXPLODE_WALL_MM * anim.explode;
    frontRef.current?.position.set(0, -out, 0);
    rightRef.current?.position.set(out, 0, 0);
    const groups: Record<Where, Group | null> = { front: frontRef.current, right: rightRef.current, part: partRef.current };
    const shown = anim.lidAlpha < 0.5 || anim.explode > 0.5;
    if (shown !== insideShown) setInsideShown(shown);

    anchors.forEach((a, i) => {
      const el = labelElements[i];
      const g = groups[a.where];
      if (!el || !g) return;
      g.localToWorld(v.set(...a.at)).project(camera);
      if (v.z > 1 || v.z < -1) {
        el.style.visibility = "hidden";
        return;
      }
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      el.style.visibility = "visible";
    });
  });

  const draw = (segs: Seg[], color: string) =>
    segs.length > 0 && (
      <Line points={segs.flat()} segments color={color} lineWidth={1} transparent opacity={0.65} depthTest={false} renderOrder={10} />
    );

  return (
    <group>
      <group ref={frontRef}>{draw(lines.front, LINE)}</group>
      <group ref={rightRef}>{draw(lines.right, LINE)}</group>
      <group ref={partRef}>{draw(lines.part, PART_LINE)}</group>
    </group>
  );
}

function buildLines(design: CrateDesign, withPart: boolean) {
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
    { at: mid(La, Lb), value: ext[0], where: "front" },
    { at: mid(Wa, Wb), value: ext[1], where: "right" },
    { at: mid(Wb, Hb), value: ext[2], where: "right" },
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
      lines.part.push(seg);
      anchors.push({ at: mid(...seg), value, where: "part" });
    }
  }
  return { lines, anchors };
}

"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BoxGeometry, Color, EdgesGeometry, LineBasicMaterial, MeshStandardMaterial, type Group } from "three";
import type { CrateDesign, Member } from "@/domain/crate";
import { anim } from "@/state/motion";
import { useDesigner } from "@/state/store";
import { cradleGeometry } from "./cradleGeometry";
import { CLICK_SLOP_PX, EDGE, explodeOffset, GHOST_BOARD, GHOST_EDGE, hasFocus, ICE, ICE_EDGE, isLit, memberAlpha, setOpacity, WOOD } from "./scene";
import { boardTooltipDetail } from "@/lib/format";

const UNIT_BOX = new BoxGeometry(1, 1, 1);
const UNIT_EDGES = new EdgesGeometry(UNIT_BOX);
/** Boards fainter than this can't be hovered or clicked; the pointer passes through to what is behind. */
const PICKABLE_ALPHA = 0.5;

/**
 * Every board as a unit box scaled to size. Position, opacity and colour are
 * written imperatively each frame from `anim` and the store, so explode,
 * fades and highlighting animate without re-rendering React.
 */
export function CrateModel({ design }: { design: CrateDesign }) {
  const { members } = design;
  const groups = useRef<(Group | null)[]>([]);
  const alphas = useRef<number[]>([]);

  const materials = useMemo(
    () =>
      members.map((m) => ({
        base: new Color(WOOD[m.kind]),
        face: new MeshStandardMaterial({ color: WOOD[m.kind], roughness: 0.85, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
        edge: new LineBasicMaterial({ color: EDGE, transparent: true, opacity: 0.55 }),
      })),
    [members],
  );
  useEffect(
    () => () =>
      materials.forEach((m) => {
        m.face.dispose();
        m.edge.dispose();
      }),
    [materials],
  );
  // Notched cradles get their own solid; every other board is the shared unit box, scaled.
  const shapes = useMemo(
    () =>
      members.map((m) => {
        if (!m.cradle) return null;
        const solid = cradleGeometry(m);
        return { solid, edges: new EdgesGeometry(solid, 20) };
      }),
    [members],
  );
  useEffect(
    () => () =>
      shapes.forEach((s) => {
        s?.solid.dispose();
        s?.edges.dispose();
      }),
    [shapes],
  );

  // The explode amount the boards were last placed at; NaN forces a placement (new boards).
  const placedAt = useRef(NaN);
  useEffect(() => {
    placedAt.current = NaN;
  }, [members]);

  useFrame(() => {
    const s = useDesigner.getState();
    const focus = hasFocus(s);
    const place = anim.explode !== placedAt.current;
    placedAt.current = anim.explode;
    members.forEach((m, i) => {
      const g = groups.current[i];
      if (!g) return;
      const lit = isLit(s, m);
      const ghost = focus && !lit;
      let alpha = memberAlpha(m, s.view);
      if (lit && focus) alpha = 1;
      alphas.current[i] = ghost ? 0 : alpha;

      // Boards only move when the explode amount does.
      if (place) {
        const off = explodeOffset(m.face, anim.explode);
        g.position.set(m.min[0] + m.size[0] / 2 + off[0], m.min[1] + m.size[1] / 2 + off[1], m.min[2] + m.size[2] / 2 + off[2]);
      }

      const opacity = ghost ? Math.min(alpha, GHOST_BOARD) : alpha;
      g.visible = opacity > 0.01;
      const { face, edge, base } = materials[i];
      face.color.copy(lit ? ICE : base);
      setOpacity(face, opacity);
      edge.color.copy(lit ? ICE_EDGE : ghost ? GHOST_EDGE : EDGE);
      edge.opacity = lit ? 0.95 : ghost ? 0.13 : 0.55 * opacity;
    });
  });

  const onMove = (m: Member, i: number) => (e: ThreeEvent<PointerEvent>) => {
    if ((alphas.current[i] ?? 1) < PICKABLE_ALPHA) return;
    e.stopPropagation();
    const s = useDesigner.getState();
    const line = s.result.design?.bom.find((l) => l.key === m.bomKey);
    if (!line) return;
    s.setHover({ key: line.key, source: "3d" });
    s.setTooltip({
      x: e.nativeEvent.clientX,
      y: e.nativeEvent.clientY,
      title: line.label,
      detail: boardTooltipDetail(line, s.units),
    });
  };

  const onOut = (m: Member) => () => {
    const s = useDesigner.getState();
    if (s.hover?.source === "3d" && s.hover.key === m.bomKey) {
      s.setHover(null);
      s.setTooltip(null);
    }
  };

  const onClick = (m: Member, i: number) => (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > CLICK_SLOP_PX || (alphas.current[i] ?? 1) < PICKABLE_ALPHA) return;
    e.stopPropagation();
    const s = useDesigner.getState();
    const next = s.pin === m.bomKey ? null : m.bomKey;
    s.setPin(next);
    if (next) s.setTab("cut");
  };

  return (
    <group>
      {members.map((m, i) => (
        <group
          key={i}
          ref={(g) => {
            groups.current[i] = g;
          }}
        >
          <mesh
            geometry={shapes[i]?.solid ?? UNIT_BOX}
            material={materials[i].face}
            scale={shapes[i] ? 1 : m.size}
            onPointerMove={onMove(m, i)}
            onPointerOut={onOut(m)}
            onClick={onClick(m, i)}
          />
          <lineSegments geometry={shapes[i]?.edges ?? UNIT_EDGES} material={materials[i].edge} scale={shapes[i] ? 1 : m.size} />
        </group>
      ))}
    </group>
  );
}

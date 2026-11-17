"use client";

import { Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Vector3, type Group } from "three";
import type { Line2, LineSegments2 } from "three-stdlib";
import type { CrateDesign } from "@/domain/crate";
import type { Vec3 } from "@/domain/schema";
import { length, lengthUnit, type Units } from "@/lib/units";
import { anim, pulse } from "@/state/motion";
import { reducedMotion, useDesigner } from "@/state/store";
import { buildLines, createPulseClock, dimensionPulses, PULSE_DURATION_S, tickPulse, type Where } from "./dimensionPulse";
import { PhotonLayer } from "./PhotonLayer";
import { EXPLODE_WALL_MM } from "./scene";
import { labelElements } from "./SizeLabels";

const LINE = "#e6eef7";
const PART_LINE = "#70b8fd";
const LINE_OPACITY = 0.65;
/** How much a pulse brightens the lines it runs along, at its peak (#65). */
const LINE_GLOW = 0.25;
const WHERE: Where[] = ["front", "right", "part"];

const v = new Vector3();

/**
 * Size lines, in crate-interior mm. Crate: length along the front bottom edge,
 * width along the right bottom edge, height at the back right corner. They
 * slide out with the walls when exploded but keep the assembled numbers.
 * Part: one part (top layer, front row, rightmost) in ice blue, only once the
 * inside is on show. Lines skip depth testing so they are never buried; the
 * labels are DOM elements (see SizeLabels) positioned here every frame.
 *
 * Every 10 s (first 2 s after mounting) a photon pulse leaves each label and runs out along its
 * dimension, splitting at every vertex (#65; paths in `dimensionPulse.ts`, drawn by
 * `PhotonLayer`). It is ambient: never with reduced motion, restarted (not queued) after the tab
 * was hidden, and it never counts as input.
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
  const pulses = useMemo(() => {
    const all = dimensionPulses(lines, anchors);
    return { front: all.filter((p) => p.where === "front"), right: all.filter((p) => p.where === "right"), part: all.filter((p) => p.where === "part") };
  }, [lines, anchors]);
  const [layers] = useState(() => ({ front: new PhotonLayer(LINE), right: new PhotonLayer(LINE), part: new PhotonLayer(PART_LINE) }));
  const lineRefs = useRef<Partial<Record<Where, Line2 | LineSegments2 | null>>>({});
  const clock = useRef(createPulseClock());
  const wasHidden = useRef(false);

  useEffect(() => {
    const onVisibility = () => void (document.hidden && (wasHidden.current = true));
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      for (const w of WHERE) layers[w].dispose();
      pulse.active = 0;
    };
  }, [layers]);

  useEffect(() => {
    setLabels(anchors.map((a) => ({ text: `${length(a.value, units)} ${lengthUnit(units)}`, inner: a.where === "part" })));
  }, [anchors, units, setLabels]);
  useEffect(() => () => setLabels([]), [setLabels]);

  useFrame((state, dt) => {
    // A hidden tab, or reduced motion, restarts the clock: no burst of queued pulses on return.
    const on = !reducedMotion() && !document.hidden && !wasHidden.current;
    wasHidden.current = false;
    const tick = tickPulse(clock.current, dt, on);
    if (tick.fired) pulse.fired++;
    let active = 0;
    for (const w of WHERE) active += layers[w].update(pulses[w], tick.since, state.viewport.dpr);
    pulse.active = active;
    const glow = tick.since >= 0 ? LINE_GLOW * Math.sin(Math.PI * Math.min(1, tick.since / PULSE_DURATION_S)) : 0;
    for (const w of WHERE) {
      const line = lineRefs.current[w];
      if (line) line.material.opacity = LINE_OPACITY + glow;
    }

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

  // Each group holds its lines and their photons, so the photons move with the lines.
  const draw = (w: Where, color: string) => (
    <>
      {lines[w].length > 0 && (
        <Line
          ref={(l) => void (lineRefs.current[w] = l)}
          points={lines[w].flat()}
          segments
          color={color}
          lineWidth={1}
          transparent
          opacity={LINE_OPACITY}
          depthTest={false}
          renderOrder={10}
        />
      )}
      <primitive object={layers[w].points} />
    </>
  );

  return (
    <group>
      <group ref={frontRef}>{draw("front", LINE)}</group>
      <group ref={rightRef}>{draw("right", LINE)}</group>
      <group ref={partRef}>{draw("part", PART_LINE)}</group>
    </group>
  );
}

/**
 * Anchors of the crate's size labels (length, width, height) in crate-interior mm, moved out
 * with the walls by explode amount `e`, as `DimensionLines` draws them. `Director` frames these.
 * The part's labels sit inside the crate, so they don't need their own room.
 */
export function crateLabelAnchors(design: CrateDesign, e: number): Vec3[] {
  const out = EXPLODE_WALL_MM * e;
  return buildLines(design, false).anchors.map(({ at, where }) =>
    where === "front" ? [at[0], at[1] - out, at[2]] : where === "right" ? [at[0] + out, at[1], at[2]] : at,
  );
}

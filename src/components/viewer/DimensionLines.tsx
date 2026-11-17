"use client";

import { Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Vector3, type Group } from "three";
import type { Line2, LineSegments2 } from "three-stdlib";
import type { CrateDesign } from "@/domain/crate";
import { anim } from "@/state/motion";
import { reducedMotion } from "@/state/motion";
import { buildLines, separatePills, type Axis, type PillBox, type Where } from "./sizeLines";
import { createPulseClock, dimensionPulses, PULSE_DURATION_S, tickPulse } from "./dimensionPulse";
import { PhotonLayer } from "./PhotonLayer";
import { PROBE, probeStats } from "./probeStats";
import { EXPLODE_WALL_MM } from "./scene";
import { labelElements } from "./SizeLabels";

const LINE = "#e6eef7";
const PART_LINE = "#70b8fd";
const LINE_OPACITY = 0.65;
/** How much a pulse brightens the lines it runs along, at its peak. */
const LINE_GLOW = 0.25;
const WHERE: Where[] = ["front", "right", "part"];
const NO_PULSES: never[] = [];

const v = new Vector3();
/** Per-frame scratch for the label pass: which labels show, and the pill boxes in priority order. */
const shown: boolean[] = [];
const pills: PillBox[] = [];
const pillOf: number[] = [];

/**
 * Size lines, in crate-interior mm. Crate: length along the front bottom edge, width along the
 * right bottom edge, height at the back right corner. They slide out with the walls when exploded
 * but keep the assembled numbers. Part: one part (top layer, front row, rightmost) in ice blue,
 * shown once the inside is on show. `hide` leaves out the dimension whose axis points at the
 * camera in a straight-on preset. Lines skip depth testing so they are never buried; the labels
 * are DOM elements (see `SizeLabels`) positioned here every frame.
 *
 * The part's lines are always built and the group is shown or hidden in the frame loop, so
 * opening the crate never rebuilds geometry mid-frame.
 *
 * Every 10 s (first 2 s after mounting) a photon pulse leaves each dimension and runs out along
 * it, splitting at every vertex (paths in `dimensionPulse.ts`, drawn by `PhotonLayer`). It is
 * ambient: never with reduced motion, restarted (not queued) after the tab was hidden, and it
 * never counts as input.
 */
export function DimensionLines({ design, showParts, hide }: { design: CrateDesign; showParts: boolean; hide: Axis | null }) {
  const frontRef = useRef<Group>(null);
  const rightRef = useRef<Group>(null);
  const partRef = useRef<Group>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const { lines, anchors, labels } = useMemo(() => buildLines(design, showParts, hide), [design, showParts, hide]);
  const pulses = useMemo(() => {
    const all = dimensionPulses(lines, anchors);
    return { front: all.filter((p) => p.where === "front"), right: all.filter((p) => p.where === "right"), part: all.filter((p) => p.where === "part") };
  }, [lines, anchors]);
  const [layers] = useState(() => ({ front: new PhotonLayer(LINE), right: new PhotonLayer(LINE), part: new PhotonLayer(PART_LINE) }));
  const lineRefs = useRef<Partial<Record<Where, Line2 | LineSegments2 | null>>>({});
  const clock = useRef(createPulseClock());
  const wasHidden = useRef(false);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) wasHidden.current = true;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      for (const w of WHERE) layers[w].dispose();
      if (PROBE) probeStats.photonsActive = 0;
    };
  }, [layers]);

  useFrame((state, dt) => {
    // A hidden tab, or reduced motion, restarts the clock: no burst of queued pulses on return.
    const on = !reducedMotion() && !document.hidden && !wasHidden.current;
    wasHidden.current = false;
    const tick = tickPulse(clock.current, dt, on);

    // The part's lines show once the inside is on show: open or exploded.
    const partShown = showParts && (anim.lidAlpha < 0.5 || anim.explode > 0.5);
    if (partRef.current) partRef.current.visible = partShown;

    let active = 0;
    for (const w of WHERE) active += layers[w].update(w === "part" && !partShown ? NO_PULSES : pulses[w], tick.since, state.viewport.dpr);
    if (PROBE) {
      if (tick.fired) probeStats.pulsesFired++;
      probeStats.photonsActive = active;
    }
    const glow = tick.since >= 0 ? LINE_GLOW * Math.sin(Math.PI * Math.min(1, tick.since / PULSE_DURATION_S)) : 0;
    for (const w of WHERE) {
      const line = lineRefs.current[w];
      if (line) line.material.opacity = LINE_OPACITY + glow;
    }

    const out = EXPLODE_WALL_MM * anim.explode;
    frontRef.current?.position.set(0, -out, 0);
    rightRef.current?.position.set(out, 0, 0);
    const groups: Record<Where, Group | null> = { front: frontRef.current, right: rightRef.current, part: partRef.current };

    // Labels in two passes (read every size, then write every style) so no read follows a write.
    pills.length = 0;
    labels.forEach((l, i) => {
      const el = labelElements[i];
      const g = groups[l.where];
      shown[i] = false;
      if (!el || !g) return;
      g.localToWorld(v.set(...l.at)).project(camera);
      if ((l.where === "part" && !partShown) || v.z > 1 || v.z < -1) return;
      shown[i] = true;
      pillOf[i] = pills.push({ x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height, w: el.offsetWidth, h: el.offsetHeight }) - 1;
    });
    // The part's pill, which comes last, steps clear of the crate's rather than overlap them.
    separatePills(pills);
    labels.forEach((_, i) => {
      const el = labelElements[i];
      if (!el) return;
      if (!shown[i]) {
        el.style.visibility = "hidden";
        return;
      }
      const p = pills[pillOf[i]];
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
      el.style.visibility = "visible";
    });
  });

  // Each group holds its lines and their photons, so the photons move with the lines.
  const draw = (w: Where, color: string) => (
    <>
      {lines[w].length > 0 && (
        <Line
          ref={(l) => {
            lineRefs.current[w] = l;
          }}
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
      <group ref={partRef} visible={false}>
        {draw("part", PART_LINE)}
      </group>
    </group>
  );
}

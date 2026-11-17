"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Box3, Vector3 } from "three";
import type { Layout } from "@/domain/packing";
import { roundSizeMm } from "@/lib/partFrame";
import { scheduleProfile } from "@/lib/partProfile";
import { partWeight } from "@/lib/units";
import { useDesigner } from "@/state/store";
import { useView } from "@/state/viewStore";
import { cloneWithMaterial, GHOST_PART, hasFocus, partMaterial, setOpacity } from "./scene";
import { type LoadedPart } from "@/lib/part";
import { useModelScene } from "./useModelScene";

/**
 * Takes the part's model from the registry (`useModelScene`) and places a copy in every filled slot.
 *
 * The model is turned to Z up (the part's up axis, `framedScene`), scaled (model units → mm) and
 * re-centred on its bounding box: the source models are not centred on their origin, however far
 * from it they sit.
 */
export function PartInstances({ part, layout }: { part: LoadedPart; layout: Layout }) {
  const scene = useModelScene(part.modelUrl, part.upAxis);
  const setMeasured = useDesigner((s) => s.setMeasured);

  const { center, sizeMm } = useMemo(() => {
    const box = new Box3().setFromObject(scene);
    const size = box.getSize(new Vector3()).multiplyScalar(part.mmPerUnit);
    return { center: box.getCenter(new Vector3()), sizeMm: roundSizeMm([size.x, size.y, size.z]) };
  }, [scene, part.mmPerUnit]);
  useEffect(() => {
    setMeasured(sizeMm);
  }, [sizeMm, setMeasured]);

  // Shaped blocking: measure the part's outline once the crate is on screen, when the
  // browser is idle. Until then, and if it fails, blocking follows the bounding box.
  const setPartProfile = useDesigner((s) => s.setPartProfile);
  const analysed = !!part.profile;
  useEffect(() => {
    if (analysed) return;
    return scheduleProfile(part.modelUrl, scene, part.mmPerUnit, setPartProfile, `${part.modelUnits}/${part.upAxis}`);
  }, [analysed, part.modelUrl, part.modelUnits, part.upAxis, scene, part.mmPerUnit, setPartProfile]);

  const material = useMemo(() => partMaterial(part.material), [part.material]);
  // useFrame updates the material in place through a ref (three.js objects are mutable by design).
  const materialRef = useRef(material);
  useEffect(() => {
    materialRef.current = material;
    return () => material.dispose();
  }, [material]);

  const count = layout.slots.length;
  const copies = useMemo(() => Array.from({ length: count }, () => cloneWithMaterial(scene, material)), [scene, material, count]);

  useFrame(() => {
    const opacity = hasFocus(useView.getState()) ? GHOST_PART : 1;
    setOpacity(materialRef.current, opacity);
  });

  const onMove = (i: number) => (e: ThreeEvent<PointerEvent>) => {
    if (hasFocus(useView.getState())) return;
    e.stopPropagation();
    const view = useView.getState();
    view.setHover(null);
    view.setTooltip({
      x: e.nativeEvent.clientX,
      y: e.nativeEvent.clientY,
      title: part.name,
      detail: `Part ${i + 1} of ${count}. ${part.material ?? "Material not given"}, ${partWeight(part.mass_kg, view.units)}`,
    });
  };
  const onOut = () => useView.getState().setTooltip(null);

  const [a, b, c] = layout.cellSize;
  return (
    <group>
      {layout.slots.map((slot, i) => (
        <group key={i} position={[slot.min[0] + a / 2, slot.min[1] + b / 2, slot.min[2] + c / 2]} rotation={layout.orientation.euler}>
          <group scale={part.mmPerUnit}>
            <primitive object={copies[i]} position={center.clone().negate()} onPointerMove={onMove(i)} onPointerOut={onOut} />
          </group>
        </group>
      ))}
    </group>
  );
}

"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Box3, Vector3 } from "three";
import type { Layout } from "@/domain/packing";
import type { Vec3 } from "@/domain/schema";
import { scheduleProfile } from "@/lib/partProfile";
import { partWeight } from "@/lib/units";
import { useDesigner, type LoadedPart } from "@/state/store";
import { cloneWithMaterial, GHOST_PART, highlightOf, partMaterial, setOpacity } from "./scene";

/**
 * Loads the part GLB once and places a copy in every filled slot.
 *
 * GLBs are Z-up like the crate frame, so only a scale (model units → mm) and a
 * re-centre on the bounding box are needed — the source models are not
 * centred on their origin.
 */
export function PartInstances({ part, layout }: { part: LoadedPart; layout: Layout }) {
  const { scene } = useGLTF(part.modelUrl);
  const setMeasured = useDesigner((s) => s.setMeasured);

  const { center, sizeMm } = useMemo(() => {
    const box = new Box3().setFromObject(scene);
    const size = box.getSize(new Vector3()).multiplyScalar(part.mmPerUnit);
    return { center: box.getCenter(new Vector3()), sizeMm: [size.x, size.y, size.z] as Vec3 };
  }, [scene, part.mmPerUnit]);
  useEffect(() => {
    setMeasured(sizeMm);
  }, [sizeMm, setMeasured]);

  // Shaped blocking (#16): measure the part's outline once the crate is on screen, when the
  // browser is idle. Until then, and if it fails, blocking follows the bounding box.
  const setPartProfile = useDesigner((s) => s.setPartProfile);
  const analysed = !!part.profile;
  useEffect(() => {
    if (analysed) return;
    return scheduleProfile(part.modelUrl, scene, part.mmPerUnit, setPartProfile);
  }, [analysed, part.modelUrl, scene, part.mmPerUnit, setPartProfile]);

  const material = useMemo(() => partMaterial(part.material), [part.material]);
  // useFrame updates the material in place through a ref (three.js objects are mutable by design).
  const materialRef = useRef(material);
  useEffect(() => {
    materialRef.current = material;
    return () => material.dispose();
  }, [material]);

  const count = layout.slots.length;
  const copies = useMemo(
    () => Array.from({ length: count }, () => cloneWithMaterial(scene, material)),
    [scene, material, count],
  );

  useFrame(() => {
    const s = useDesigner.getState();
    const opacity = highlightOf(s).focus ? GHOST_PART : 1;
    setOpacity(materialRef.current, opacity);
  });

  const onMove = (i: number) => (e: ThreeEvent<PointerEvent>) => {
    if (highlightOf(useDesigner.getState()).focus) return;
    e.stopPropagation();
    const s = useDesigner.getState();
    s.setHover(null);
    s.setTooltip({
      x: e.nativeEvent.clientX,
      y: e.nativeEvent.clientY,
      title: part.name,
      detail: `Part ${i + 1} of ${count}. ${part.material ?? "Material not given"}, ${partWeight(part.mass_kg, s.units)}`,
    });
  };
  const onOut = () => useDesigner.getState().setTooltip(null);

  const [a, b, c] = layout.cellSize;
  return (
    <group>
      {layout.slots.map((slot, i) => (
        <group
          key={i}
          position={[slot.min[0] + a / 2, slot.min[1] + b / 2, slot.min[2] + c / 2]}
          rotation={layout.orientation.euler}
        >
          <group scale={part.mmPerUnit}>
            <primitive object={copies[i]} position={center.clone().negate()} onPointerMove={onMove(i)} onPointerOut={onOut} />
          </group>
        </group>
      ))}
    </group>
  );
}

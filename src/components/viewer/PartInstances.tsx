"use client";

import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { Box3, Mesh, MeshStandardMaterial, Vector3, type Object3D } from "three";
import type { Layout } from "@/domain/packing";
import type { Part, Vec3 } from "@/domain/schema";

const METERS_TO_MM = 1000;

/**
 * Loads a part GLB once and places one copy in every filled slot of the layout.
 *
 * The GLBs are Z-up and in meters, matching the crate frame, so no axis swap is
 * needed here — only a ×1000 scale and recentering on the bounding box (the
 * source models are not centered on their origin).
 */
export function PartInstances({
  part,
  url,
  layout,
  onMeasured,
}: {
  part: Part;
  url: string;
  layout: Layout;
  onMeasured?: (sizeMm: Vec3) => void;
}) {
  const { scene } = useGLTF(url);

  const { center, sizeMm, material } = useMemo(() => {
    const box = new Box3().setFromObject(scene);
    const size = box.getSize(new Vector3()).multiplyScalar(METERS_TO_MM);
    const isAluminum = part.material.toLowerCase().includes("alum");
    return {
      center: box.getCenter(new Vector3()),
      sizeMm: [size.x, size.y, size.z] as Vec3,
      material: new MeshStandardMaterial({
        // Moderate metalness: there's no environment map to reflect, and fully
        // metallic surfaces render near-black without one.
        color: isAluminum ? "#c4cad3" : "#8a929b",
        metalness: 0.35,
        roughness: isAluminum ? 0.35 : 0.45,
      }),
    };
  }, [scene, part.material]);

  useEffect(() => onMeasured?.(sizeMm), [sizeMm, onMeasured]);

  const count = layout.slots.length;
  const copies = useMemo(
    () => Array.from({ length: count }, () => cloneWithMaterial(scene, material)),
    [scene, material, count],
  );

  const [a, b, c] = layout.cellSize;
  return (
    <group>
      {layout.slots.map((slot, i) => (
        <group
          key={i}
          position={[slot.min[0] + a / 2, slot.min[1] + b / 2, slot.min[2] + c / 2]}
          rotation={layout.orientation.euler}
        >
          <group scale={METERS_TO_MM}>
            <primitive object={copies[i]} position={center.clone().negate()} />
          </group>
        </group>
      ))}
    </group>
  );
}

/** Each slot needs its own Object3D; geometry buffers stay shared. */
function cloneWithMaterial(scene: Object3D, material: MeshStandardMaterial): Object3D {
  const copy = scene.clone(true);
  copy.traverse((o) => {
    if (o instanceof Mesh) {
      o.material = material;
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return copy;
}

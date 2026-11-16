"use client";

import { ContactShadows, Grid, OrbitControls, useProgress } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useEffect } from "react";
import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { CrateDesign } from "@/domain/crate";
import type { Part, Vec3 } from "@/domain/schema";
import { CrateModel, type ViewMode } from "./CrateModel";
import { PartInstances } from "./PartInstances";

const MM_TO_M = 0.001;
const FOV_DEG = 40;
/** Viewing direction for the default three-quarter view (three.js Y-up). */
const VIEW_DIRECTION = new Vector3(1, 0.8, 1.3).normalize();

export interface CrateViewerProps {
  design: CrateDesign;
  part: Part;
  modelUrl: string;
  mode: ViewMode;
  onMeasured?: (sizeMm: Vec3) => void;
}

/**
 * The 3D scene. three.js is Y-up; the domain is Z-up in mm. A single root group
 * rotates Z-up → Y-up and scales mm → m, so everything inside it uses domain
 * coordinates directly.
 */
export default function CrateViewer({
  design,
  part,
  modelUrl,
  mode,
  onMeasured,
}: CrateViewerProps) {
  const [L, W] = design.layout.interior;
  const { floorMm, skid } = design.construction;
  // Center the crate on the origin, with the bottom of the skids on the ground.
  const origin: Vec3 = [-L / 2, -W / 2, floorMm + skid.tall];

  return (
    <>
      <Canvas
        shadows
        camera={{ position: [2, 1.6, 2.4], fov: FOV_DEG, near: 0.01, far: 100 }}
        dpr={[1, 2]}
      >
        <color attach="background" args={["#eef0f2"]} />
        <hemisphereLight args={["#ffffff", "#b9a88f", 1.1]} />
        <directionalLight
          position={[3, 6, 4]}
          intensity={2.2}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-4}
          shadow-camera-right={4}
          shadow-camera-top={4}
          shadow-camera-bottom={-4}
        />

        <Suspense fallback={null}>
        <group rotation={[-Math.PI / 2, 0, 0]} scale={MM_TO_M}>
            <group position={origin}>
              <CrateModel design={design} mode={mode} />
              <PartInstances
                part={part}
                url={modelUrl}
                layout={design.layout}
                onMeasured={onMeasured}
              />
            </group>
          </group>
        </Suspense>
        <CameraRig external={design.layout.external} exploded={mode === "exploded"} />

        <ContactShadows
          position={[0, 0.001, 0]}
          opacity={0.35}
          scale={8}
          blur={2.5}
          far={3}
        />
        <Grid
          args={[20, 20]}
          cellSize={0.1}
          sectionSize={1}
          cellColor="#cfd4da"
          sectionColor="#a9b1ba"
          fadeDistance={14}
          infiniteGrid
        />
        <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.05} />
      </Canvas>
      <LoadingOverlay />
    </>
  );
}

/**
 * Frames the crate whenever its size changes: fit the crate's bounding sphere in
 * the field of view, looking at its centre. Computed from the known external
 * dimensions rather than measuring the scene, so it is deterministic.
 */
function CameraRig({ external, exploded }: { external: Vec3; exploded: boolean }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const aspect = useThree((s) => s.size.width / s.size.height);
  const [L, W, H] = external;

  useEffect(() => {
    const radius = 0.5 * Math.hypot(L, W, H) * MM_TO_M + (exploded ? 0.35 : 0);
    // The tighter of the vertical and horizontal half-angles limits the fit.
    const halfV = MathUtils.degToRad(FOV_DEG / 2);
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    const distance = (radius / Math.sin(Math.min(halfV, halfH))) * 1.05;
    const target = new Vector3(0, (H * MM_TO_M) / 2, 0);
    camera.position.copy(target).addScaledVector(VIEW_DIRECTION, distance);
    camera.lookAt(target);
    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
  }, [camera, controls, aspect, L, W, H, exploded]);

  return null;
}

/** DOM overlay (outside the Canvas) while GLBs download. */
function LoadingOverlay() {
  const { active } = useProgress();
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-500">
      Loading model…
    </div>
  );
}

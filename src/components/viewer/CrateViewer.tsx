"use client";

import { OrbitControls, useProgress } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { lazy, Suspense, useRef } from "react";
import { useDesigner } from "@/state/store";
import { CrateModel } from "./CrateModel";
import { DimensionLines } from "./DimensionLines";
import { Director, FOV_DEG } from "./Director";
import { Floor } from "./Floor";
import { PartInstances } from "./PartInstances";
import { sceneOrigin } from "./scene";

const MM_TO_M = 0.001;
const CLICK_SLOP_PX = 5;
/** Orbit limit in m, raised for crates large enough to need more room. */
const MAX_DISTANCE_M = 60;

/**
 * Read-only `window.__crate` state hook for the Playwright suite (#34). The flag is inlined at
 * build time, so normal builds drop this branch and never bundle the module.
 */
const E2EProbe = process.env.NEXT_PUBLIC_E2E === "1" ? lazy(() => import("./E2EProbe")) : null;

/**
 * The 3D scene. three.js is Y-up in metres; the domain is Z-up in mm. One root
 * group rotates Z-up → Y-up and scales mm → m, so everything inside it uses
 * domain coordinates directly. The canvas is transparent: the page gradient
 * is the background.
 */
export default function CrateViewer() {
  const design = useDesigner((s) => s.result.design);
  const part = useDesigner((s) => s.part);
  const units = useDesigner((s) => s.units);
  const view = useDesigner((s) => s.view);
  const problem = useDesigner((s) => s.result.problem);
  const down = useRef<[number, number] | null>(null);
  // The last-opened crate is being reopened (#71): show nothing rather than flash the default one.
  const restoring = useDesigner((s) => s.restoring);

  if (restoring) return null;
  if (!design) return <div className="stage-msg">{problem?.title ?? "No crate to show."}</div>;

  const origin = sceneOrigin(design);
  const maxDistance = Math.max(MAX_DISTANCE_M, 4 * Math.max(...design.layout.external) * MM_TO_M);

  const clearHover = () => {
    const s = useDesigner.getState();
    if (s.hover?.source === "3d") s.setHover(null);
    s.setTooltip(null);
  };

  return (
    <>
      <Canvas
        camera={{ position: [2.4, 1.8, 2.8], fov: FOV_DEG, near: 0.02, far: 200 }}
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        onPointerDown={(e) => void (down.current = [e.clientX, e.clientY])}
        onPointerLeave={clearHover}
        onPointerMissed={(e) => {
          const d = down.current;
          if (d && Math.hypot(e.clientX - d[0], e.clientY - d[1]) > CLICK_SLOP_PX) return;
          useDesigner.getState().setPin(null);
          clearHover();
        }}
      >
        <hemisphereLight args={["#e9edf2", "#2a3f57", 1.35]} />
        <directionalLight position={[3, 6, 4]} intensity={1.7} color="#fff1dc" />
        <directionalLight position={[-4, 3, -2]} intensity={0.35} color="#cfe3ff" />

        <Floor external={design.layout.external} units={units} />
        <group rotation={[-Math.PI / 2, 0, 0]} scale={MM_TO_M}>
          <group position={origin}>
            <CrateModel design={design} />
            {view.parts && (
              <Suspense fallback={null}>
                <PartInstances part={part} layout={design.layout} />
              </Suspense>
            )}
            {view.dims && <DimensionLines design={design} units={units} showParts={view.parts} />}
          </group>
        </group>

        <Director />
        {E2EProbe && (
          <Suspense fallback={null}>
            <E2EProbe />
          </Suspense>
        )}
        <OrbitControls makeDefault enableDamping={false} maxPolarAngle={Math.PI / 2 - 0.02} minDistance={0.3} maxDistance={maxDistance} />
      </Canvas>
      <LoadingOverlay />
    </>
  );
}

/** DOM overlay while a GLB downloads. Never use drei <Html> as a Suspense fallback (unmount race). */
function LoadingOverlay() {
  const { active } = useProgress();
  if (!active) return null;
  return <div className="stage-msg">Loading model…</div>;
}

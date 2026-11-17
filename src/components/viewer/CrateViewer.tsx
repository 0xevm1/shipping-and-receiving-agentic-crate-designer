"use client";

import { OrbitControls, useGLTF, useProgress } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { pointer } from "@/state/motion";
import { useDesigner } from "@/state/store";
import { CrateModel } from "./CrateModel";
import styles from "./CrateViewer.module.css";
import { DimensionLines } from "./DimensionLines";
import { hiddenAxis } from "./sizeLines";
import { Director } from "./Director";
import { Floor } from "./Floor";
import { HandlingMarks } from "./HandlingMarks";
import { PartInstances } from "./PartInstances";
import { CAMERA_FAR_M, CLICK_SLOP_PX, FOV_DEG, MM_TO_M, sceneOrigin } from "./scene";

/** Orbit limit in m, raised for crates large enough to need more room. */
const MAX_DISTANCE_M = 60;

/**
 * `window.__crate` state hook for the Playwright suite. The flag is inlined at build time, so
 * normal builds drop this branch and never bundle the module.
 */
const E2EProbe = process.env.NEXT_PUBLIC_E2E === "1" ? lazy(() => import("./E2EProbe")) : null;

/**
 * The 3D scene. three.js is Y-up in metres; the domain is Z-up in mm. One root
 * group rotates Z-up → Y-up and scales mm → m, so everything inside it uses
 * domain coordinates directly. The canvas is transparent: the page gradient
 * is the background.
 *
 * The canvas stays mounted whatever the design is doing (a problem state, a restore), so the
 * WebGL context is created once; only the scene's contents come and go. If the browser takes the
 * context away, a cover with a way back replaces the blank canvas.
 */
export default function CrateViewer() {
  const design = useDesigner((s) => s.result.design);
  const part = useDesigner((s) => s.part);
  const units = useDesigner((s) => s.units);
  const view = useDesigner((s) => s.view);
  const problem = useDesigner((s) => s.result.problem);
  // The last-opened crate is being reopened: show nothing rather than flash the default one.
  const restoring = useDesigner((s) => s.restoring);
  const down = useRef<[number, number] | null>(null);
  const [lost, setLost] = useState(false);
  /** Bumped to throw the canvas away and build a fresh one (a new WebGL context). */
  const [canvasKey, setCanvasKey] = useState(0);
  useReleaseModels(part.modelUrl);

  const watchContext = useCallback((canvas: HTMLCanvasElement) => {
    // Cancelling the loss event lets the browser restore the context by itself.
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      setLost(true);
    });
    canvas.addEventListener("webglcontextrestored", () => setLost(false));
  }, []);
  const rebuild = () => {
    setLost(false);
    setCanvasKey((k) => k + 1);
  };

  const scene = restoring ? null : design;
  const origin = scene ? sceneOrigin(scene) : null;
  const maxDistance = Math.max(MAX_DISTANCE_M, 4 * Math.max(...(scene?.layout.external ?? [0])) * MM_TO_M);

  const clearHover = () => {
    const s = useDesigner.getState();
    if (s.hover?.source === "3d") s.setHover(null);
    s.setTooltip(null);
  };

  return (
    <>
      <Canvas
        key={canvasKey}
        camera={{ position: [2.4, 1.8, 2.8], fov: FOV_DEG, near: 0.02, far: CAMERA_FAR_M }}
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        onCreated={({ gl }) => watchContext(gl.domElement)}
        onPointerDown={(e) => {
          down.current = [e.clientX, e.clientY];
        }}
        onPointerMove={() => {
          pointer.inCanvas = true;
        }}
        onPointerLeave={() => {
          pointer.inCanvas = false;
          clearHover();
        }}
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

        {scene && origin && (
          <>
            <Floor external={scene.layout.external} units={units} />
            <group rotation={[-Math.PI / 2, 0, 0]} scale={MM_TO_M}>
              <group position={origin}>
                <CrateModel design={scene} />
                {view.parts && (
                  <Suspense fallback={null}>
                    <PartInstances part={part} layout={scene.layout} />
                  </Suspense>
                )}
                {view.dims && <DimensionLines design={scene} showParts={view.parts} hide={hiddenAxis(view.camera)} />}
                {/* Centre of gravity and fork entry go with the size labels. */}
                {view.dims && <HandlingMarks design={scene} />}
              </group>
            </group>
          </>
        )}

        <Director active={!!scene} />
        {E2EProbe && (
          <Suspense fallback={null}>
            <E2EProbe />
          </Suspense>
        )}
        <OrbitControls makeDefault enableDamping={false} maxPolarAngle={Math.PI / 2 - 0.02} minDistance={0.3} maxDistance={maxDistance} />
      </Canvas>
      {!restoring && !design && <div className="stage-msg">{problem?.title ?? "No crate to show."}</div>}
      <LoadingOverlay />
      {lost && (
        <div className={styles.lost} role="alert">
          <p className={styles.title}>The 3D view stopped.</p>
          <p>The browser took back the graphics it was using. Your design is safe.</p>
          <button type="button" className="btn" onClick={rebuild}>
            Bring back the 3D view
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Drops a part model from drei's GLTF cache once the part changes, so models loaded earlier in
 * the session don't pile up. Only a change releases one: the island's turntable shares the cache
 * and may still be showing the model when the main scene unmounts its copy.
 */
function useReleaseModels(modelUrl: string) {
  const previous = useRef(modelUrl);
  useEffect(() => {
    if (previous.current !== modelUrl) useGLTF.clear(previous.current);
    previous.current = modelUrl;
  }, [modelUrl]);
}

/** DOM overlay while a GLB downloads. Never use drei <Html> as a Suspense fallback (unmount race). */
function LoadingOverlay() {
  const { active } = useProgress();
  if (!active) return null;
  return <div className="stage-msg">Loading model…</div>;
}

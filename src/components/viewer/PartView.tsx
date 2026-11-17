"use client";

import { OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { Box3, MathUtils, Spherical, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { isIdle, reducedMotion } from "@/state/motion";
import { useDesigner } from "@/state/store";
import { cloneWithMaterial, FOV_DEG, MM_TO_M, partMaterial } from "./scene";
import { type LoadedPart } from "@/lib/part";
import { partViewClass } from "./PartViewSlot";

/**
 * Turn speed, rad/s: slower than the handoff's 0.45, and reversed, at the user's request.
 * Driven from frame time in useFrame rather than OrbitControls' autoRotate, which steps a
 * fixed angle per frame and so spins twice as fast on a 120 Hz display.
 */
const TURN_RATE = 0.25;
const HOME_PHI = Math.PI / 2 - 0.42;

const turn = new Spherical();

/**
 * The part on its own in the island: transparent background, slowly turning.
 * Grabbing it stops the turn; after the page has been idle for 5 s it turns
 * again from wherever it was left. Double-click resets tilt and zoom.
 */
export default function PartView() {
  const part = useDesigner((s) => s.part);
  return (
    <Canvas className={partViewClass} camera={{ fov: FOV_DEG, near: 0.001, far: 50 }} dpr={[1, 2]} gl={{ alpha: true }}>
      <hemisphereLight args={["#e9edf2", "#2a3f57", 1.4]} />
      <directionalLight position={[3, 5, 4]} intensity={1.6} color="#fff1dc" />
      <Suspense fallback={null}>
        <Turntable part={part} key={part.modelUrl} />
      </Suspense>
    </Canvas>
  );
}

function Turntable({ part }: { part: LoadedPart }) {
  const { scene } = useGLTF(part.modelUrl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useRef<OrbitControlsImpl>(null);
  const grabbed = useRef(false);
  const turning = useRef(!reducedMotion());

  const material = useMemo(() => partMaterial(part.material), [part.material]);
  useEffect(() => () => material.dispose(), [material]);
  const { object, center, radius } = useMemo(() => {
    const box = new Box3().setFromObject(scene);
    const scale = part.mmPerUnit * MM_TO_M; // model units → metres
    return {
      object: cloneWithMaterial(scene, material),
      center: box.getCenter(new Vector3()).multiplyScalar(-1),
      radius: (box.getSize(new Vector3()).length() / 2) * scale,
    };
  }, [scene, material, part.mmPerUnit]);

  // Fit the part's bounding sphere to the small canvas, keeping the current turn angle.
  const home = (keepTheta = true) => {
    const t = Math.tan(MathUtils.degToRad(FOV_DEG / 2));
    const half = Math.min(Math.atan(t), Math.atan((t * size.width) / size.height));
    const dist = (radius / Math.sin(half)) * 1.04;
    const theta = keepTheta ? turn.setFromVector3(camera.position).theta : 0.6;
    camera.position.setFromSpherical(turn.set(dist, HOME_PHI, theta));
    camera.lookAt(0, 0, 0);
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
  };
  // Re-frame when the part or the canvas size changes, not when `home` is recreated.
  useEffect(() => {
    home(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius, size.width, size.height]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c || grabbed.current || reducedMotion()) return;
    // Resume after the shared 5 s idle (hovering doesn't count as input), from wherever it was left.
    if (!turning.current && isIdle()) turning.current = true;
    if (!turning.current) return;
    turn.setFromVector3(camera.position);
    turn.theta += TURN_RATE * Math.min(dt, 0.1);
    camera.position.setFromSpherical(turn);
    camera.lookAt(0, 0, 0);
    c.update();
  });

  return (
    <>
      <group rotation={[-Math.PI / 2, 0, 0]} scale={part.mmPerUnit * MM_TO_M}>
        <primitive object={object} position={center} />
      </group>
      <OrbitControls
        ref={controls}
        enablePan={false}
        enableDamping={false}
        minDistance={radius * 1.2}
        maxDistance={radius * 12}
        onStart={() => {
          grabbed.current = true;
          turning.current = false;
        }}
        onEnd={() => {
          grabbed.current = false;
        }}
      />
      <DoubleClickReset
        onReset={() => {
          home(true);
          turning.current = !reducedMotion();
        }}
      />
    </>
  );
}

function DoubleClickReset({ onReset }: { onReset: () => void }) {
  const el = useThree((s) => s.gl.domElement);
  useEffect(() => {
    el.addEventListener("dblclick", onReset);
    return () => el.removeEventListener("dblclick", onReset);
  }, [el, onReset]);
  return null;
}

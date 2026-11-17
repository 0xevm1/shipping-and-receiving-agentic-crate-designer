"use client";

import { useEffect, useMemo } from "react";
import { BufferGeometry, Float32BufferAttribute, ShaderMaterial, Vector2 } from "three";
import type { Vec3 } from "@/domain/schema";
import { gridStepMm, type Units } from "@/lib/units";

const MM_TO_M = 0.001;
/** How far the light pool spreads past the crate footprint, in m. */
const POOL_SOFT_M = 0.9;
/** Grid radius around the crate, in m: at least this, or a multiple of the crate's longest side. */
const GRID_MIN_RADIUS_M = 5;
const GRID_RADIUS_PER_LENGTH = 3;

/**
 * The floor, in world metres (Y up, crate footprint centred on the origin):
 * a faint grid of 500 mm (or 1 ft) squares, and a soft warm light pool under
 * the crate instead of a dark contact shadow.
 *
 * The grid fades with distance from the crate, not from the camera (as drei's
 * <Grid> does), so it stays visible at every zoom and angle — as in the design
 * prototype.
 */
export function Floor({ external, units }: { external: Vec3; units: Units }) {
  const half = useMemo(() => new Vector2((external[0] * MM_TO_M) / 2, (external[1] * MM_TO_M) / 2), [external]);
  const pool = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uHalf: { value: half }, uSoft: { value: POOL_SOFT_M } },
        vertexShader: /* glsl */ `
          varying vec2 vP;
          void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec2 uHalf; uniform float uSoft; varying vec2 vP;
          void main() {
            vec2 d = max(abs(vP) - uHalf, 0.0);
            float a = 1.0 - smoothstep(0.0, uSoft, length(d));
            // Normal blending with low alpha: the canvas is transparent, so the
            // page gradient shows through with a warm tint.
            gl_FragColor = vec4(1.0, 0.8, 0.5, 0.14 * a * a);
          }`,
      }),
    [half],
  );
  const step = gridStepMm(units) * MM_TO_M;
  const longest = Math.max(external[0], external[1]) * MM_TO_M;
  const radius = Math.max(GRID_MIN_RADIUS_M, longest * GRID_RADIUS_PER_LENGTH);

  const grid = useMemo(() => {
    const pts: number[] = [];
    const n = Math.ceil(radius / step);
    for (let i = -n; i <= n; i++) {
      const v = i * step;
      pts.push(v, 0, -radius, v, 0, radius); // lines along Z
      pts.push(-radius, 0, v, radius, 0, v); // lines along X
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(pts, 3));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uRadius: { value: radius } },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uRadius; varying vec2 vP;
        void main() {
          float a = 1.0 - smoothstep(uRadius * 0.35, uRadius, length(vP));
          // Hadrian sky blue, like the line art on hadrian.co.
          gl_FragColor = vec4(0.44, 0.72, 0.99, 0.24 * a);
        }`,
    });
    return { geometry, material };
  }, [radius, step]);
  useEffect(
    () => () => {
      grid.geometry.dispose();
      grid.material.dispose();
    },
    [grid],
  );

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0005, 0]} material={pool} renderOrder={-1}>
        <planeGeometry args={[half.x * 2 + POOL_SOFT_M * 2, half.y * 2 + POOL_SOFT_M * 2]} />
      </mesh>
      <lineSegments geometry={grid.geometry} material={grid.material} position={[0, -0.001, 0]} renderOrder={-2} />
    </group>
  );
}


import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial } from "three";
import { easePulse, PULSE_DURATION_S, type DimensionPulse } from "./dimensionPulse";

/** Points per photon: the head and its tail. */
const SAMPLES = 8;
/** Photon legs one group can show at once (the right-hand group: width + height, 6 each). */
const MAX_LEGS = 16;
/** Point sizes in CSS px: head, end of the tail. */
const HEAD_PX = 13;
const TAIL_PX = 3.5;
/** Seconds the photons take to brighten as they leave the label. */
const EMERGE_S = 0.12;

const vertexShader = /* glsl */ `
  attribute float aAlpha;
  attribute float aSize;
  uniform float uPixelRatio;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    gl_PointSize = aSize * uPixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A soft dot: a narrow white-hot core inside a wider glow of the line colour.
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float glow = pow(1.0 - d, 2.0);
    float core = smoothstep(0.45, 0.0, d);
    gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.6), (glow * 0.8 + core * 0.4) * vAlpha);
    #include <colorspace_fragment>
  }
`;

/**
 * The photons of one group of size lines (#65): a single `Points` object, added to the same
 * group as the lines so it follows explode, rotation and modes. Not a React component on purpose:
 * `DimensionLines` calls `update` from its one `useFrame`, so nothing re-renders per frame.
 * Additive blending, no depth test (like the lines). Hidden between pulses, so it costs nothing.
 */
export class PhotonLayer {
  readonly points: Points;
  private readonly position = new Float32Array(MAX_LEGS * SAMPLES * 3);
  private readonly alpha = new Float32Array(MAX_LEGS * SAMPLES);
  private readonly size = new Float32Array(MAX_LEGS * SAMPLES);
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;

  constructor(color: string) {
    this.geometry.setAttribute("position", new BufferAttribute(this.position, 3));
    this.geometry.setAttribute("aAlpha", new BufferAttribute(this.alpha, 1));
    this.geometry.setAttribute("aSize", new BufferAttribute(this.size, 1));
    this.material = new ShaderMaterial({
      uniforms: { uColor: { value: new Color(color) }, uPixelRatio: { value: 1 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.renderOrder = 11;
    this.points.frustumCulled = false;
    this.points.visible = false;
    // Never pickable: hover and click go to the boards behind.
    this.points.raycast = () => {};
  }

  /**
   * Places the photons `since` seconds into a pulse (-1: none running). Each dimension's head
   * runs out from the label at one speed, eased at both ends, and reaches its furthest end (plus
   * a tail's length, so that tail fades out too) after `PULSE_DURATION_S`. Returns the photons
   * (legs) drawn.
   */
  update(pulses: DimensionPulse[], since: number, pixelRatio: number): number {
    let n = 0;
    let legs = 0;
    if (since >= 0) {
      for (const p of pulses) {
        const t = since - p.delay;
        if (t < 0 || t > PULSE_DURATION_S) continue;
        const head = easePulse(t / PULSE_DURATION_S) * (p.total + p.tail);
        const emerge = Math.min(1, t / EMERGE_S);
        for (const leg of p.legs) {
          if (legs >= MAX_LEGS || head < leg.start || head - p.tail > leg.end) continue;
          const span = leg.end - leg.start;
          let drawn = false;
          for (let k = 0; k < SAMPLES; k++) {
            const back = k / (SAMPLES - 1);
            const d = head - back * p.tail;
            if (d < leg.start || d > leg.end) continue;
            const f = span > 0 ? (d - leg.start) / span : 0;
            for (let i = 0; i < 3; i++) this.position[n * 3 + i] = leg.from[i] + (leg.to[i] - leg.from[i]) * f;
            this.alpha[n] = emerge * Math.pow(1 - back * 0.85, 1.6);
            this.size[n] = TAIL_PX + (HEAD_PX - TAIL_PX) * (1 - back);
            n++;
            drawn = true;
          }
          if (drawn) legs++;
        }
      }
    }
    this.points.visible = n > 0;
    if (n > 0) {
      this.geometry.setDrawRange(0, n);
      for (const name of ["position", "aAlpha", "aSize"]) this.geometry.getAttribute(name).needsUpdate = true;
      this.material.uniforms.uPixelRatio.value = pixelRatio;
    }
    return legs;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

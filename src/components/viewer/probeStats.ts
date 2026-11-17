import type { WebGLRenderer } from "three";
import type { Vec3 } from "@/domain/schema";

/** True in builds made with `NEXT_PUBLIC_E2E=1`; inlined at build time, so other builds drop every write guarded by it. */
export const PROBE = process.env.NEXT_PUBLIC_E2E === "1";

/**
 * What the scene reports to the Playwright test hook (`E2EProbe`). Nothing in the app reads it.
 * The writers live in the scene components, which are the only code that knows these numbers,
 * so they write here behind `if (PROBE)`: in a normal build the writes are removed.
 */
export const probeStats = {
  /** The island thumbnail's renderer (its own WebGL context), for the GPU resource counts; null before it is created. */
  thumbnail: null as WebGLRenderer | null,
  /** Dimension-line photon pulses fired since the page loaded. */
  pulsesFired: 0,
  /** Photons on screen in the last frame. */
  photonsActive: 0,
  handling: {
    /** The CoG stencils' position, or null when none are drawn. */
    cog: null as Vec3 | null,
    /** Fork-entry arrows mounted. */
    arrows: 0,
    /** Fork-entry arrows the crate isn't hiding. */
    arrowsShown: 0,
    /** Whether the −X and +X ends' arrows are shown (not hidden behind the crate). */
    endsShown: [true, true] as [boolean, boolean],
    /** The near-end (+X) arrow's screen box, CSS px, from the last frame. */
    arrowBox: null as { left: number; top: number; right: number; bottom: number } | null,
    /** Every fork arrow drawn in the last frame (not hidden behind the crate, not dropped for lack of room), screen boxes in CSS px. */
    arrowBoxes: [] as { left: number; top: number; right: number; bottom: number }[],
  },
};

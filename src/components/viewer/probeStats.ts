import type { Vec3 } from "@/domain/schema";

/** True in builds made with `NEXT_PUBLIC_E2E=1`; inlined at build time, so other builds drop every write guarded by it. */
export const PROBE = process.env.NEXT_PUBLIC_E2E === "1";

/**
 * What the scene reports to the Playwright test hook (`E2EProbe`). Nothing in the app reads it.
 * The writers live in the scene components, which are the only code that knows these numbers,
 * so they write here behind `if (PROBE)`: in a normal build the writes are removed.
 */
export const probeStats = {
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
    /** The near-end (+X) arrow's screen box, CSS px, from the last frame. */
    arrowBox: null as { left: number; top: number; right: number; bottom: number } | null,
  },
};

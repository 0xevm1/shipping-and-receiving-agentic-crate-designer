import { expect, type Page } from "@playwright/test";
import type { CrateSnapshot } from "../../src/components/viewer/E2EProbe";

export type { CrateSnapshot };

/** Reads the app's test hook (`window.__crate`, only in `NEXT_PUBLIC_E2E=1` builds). */
export function crate(page: Page): Promise<CrateSnapshot> {
  return page.evaluate(() => {
    if (!window.__crate) throw new Error("window.__crate is missing: serve a build made with NEXT_PUBLIC_E2E=1");
    return window.__crate.getState();
  });
}

/** Polls one value from the test hook until it passes `assert`. */
export function pollCrate<T>(page: Page, pick: (s: CrateSnapshot) => T, options?: { timeout?: number }) {
  return expect.poll(async () => pick(await crate(page)), options);
}

/** The scene has drawn a few frames (the test hook is installed and the canvas is live). */
export async function waitForScene(page: Page) {
  await page.waitForFunction(() => (window.__crate?.getState().frames ?? 0) > 3, undefined, { timeout: 30_000 });
}

/**
 * Waits until the scene has drawn `n` more frames, so anything positioned in `useFrame` (size
 * labels, tooltips) has caught up with the last change. Under software WebGL a frame can take
 * seconds when the machine is busy, so this counts frames instead of sleeping.
 */
export async function waitForFrames(page: Page, n = 2) {
  const start = (await crate(page)).frames;
  await pollCrate(page, (s) => s.frames, { timeout: 30_000 }).toBeGreaterThanOrEqual(start + n);
}

/**
 * After loading a new part (a GLB, catalog or not), or opening the app on the preloaded part: waits until it has opened at the quantity
 * sweep's recommended quantity and layout and settled (spec §7.16: applied, then once more for the
 * measured outline), so the numbers read next stay put. An edit settles it too. Not for pages that
 * stop the outline analysis (`disableShapeAnalysis`), which never measure. Returns the snapshot.
 */
export async function waitForRecommended(page: Page): Promise<CrateSnapshot> {
  await pollCrate(page, (s) => s.autoRecommend, { timeout: 30_000 }).toBeNull();
  // The settled recommendation's design has landed (the probe reads the design's own inputs).
  await pollCrate(page, (s) => s.recommended === null || s.quantity === s.recommended).toBe(true);
  return crate(page);
}

/** The scene is drawing and the preloaded part's model has loaded (the header shows the model check). */
async function waitForReady(page: Page) {
  await waitForScene(page);
  await expect(page.getByRole("banner")).toContainText("model matches catalog", { timeout: 30_000 });
}

/**
 * Opens the app and waits until it is ready (`waitForReady`) and the preloaded part has opened at
 * its recommended quantity and crate (spec §7.16: with nothing to restore, the default part is
 * treated as a load). Read the quantity from the probe, never pin it. A page that stops the outline
 * analysis (`disableShapeAnalysis`) passes `{ measured: false }`: it waits for the first result only.
 */
export async function openApp(page: Page, { measured = true }: { measured?: boolean } = {}) {
  await page.goto("/");
  await waitForReady(page);
  if (measured) await waitForRecommended(page);
  else {
    await pollCrate(page, (s) => s.autoRecommend, { timeout: 30_000 }).not.toBe("waiting");
    await pollCrate(page, (s) => s.recommended === null || s.quantity === s.recommended).toBe(true);
  }
}

/**
 * Loads `path` as a fresh page (a share link, say) and waits for the scene. Goes through
 * `about:blank` first so a link that only differs by its hash is a real load, not a hash change.
 * The preloaded part may not be the one that opens, so it doesn't wait for the model check.
 */
export async function openFresh(page: Page, path: string) {
  await page.goto("about:blank");
  await page.goto(path);
  await waitForScene(page);
}

/** Reloads the page and waits until it is ready again (the default part, unless the last design is restored). */
export async function reloadApp(page: Page) {
  await page.reload();
  await waitForReady(page);
}

/**
 * Picks the display units with the view bar toggle. The app opens in imperial; a spec that
 * asserts mm / kg text calls `setUnits(page, "metric")` so the units it reads are explicit.
 */
export async function setUnits(page: Page, units: "metric" | "imperial") {
  const button = page.getByRole("group", { name: "Units" }).getByRole("button", { name: units === "metric" ? "mm kg" : "in lb" });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await pollCrate(page, (s) => s.units).toBe(units);
}

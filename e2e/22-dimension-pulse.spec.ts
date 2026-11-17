import { expect, test, type Page } from "@playwright/test";
import { crate, openApp, pollCrate, shot } from "./helpers";

/**
 * Dimension-line photon pulse (#65): about every 10 s (the first 2 s after the crate frames),
 * photons leave each size label and run out along the dimension. Read through the test hook's
 * `pulses` (fired) and `photonsActive` (on screen this frame).
 */

const modeButton = (page: Page) => page.getByRole("button", { name: /view\. Click for/ });
const viewButton = (page: Page) => page.getByRole("button", { name: "View", exact: true });

/** Waits (checking every animation frame) until at least `n` photons are on screen. */
const photonsOnScreen = (page: Page, n = 1, timeout = 12_000) =>
  page.waitForFunction((min) => (window.__crate?.getState().photonsActive ?? 0) >= min, n, { timeout, polling: "raf" });

test.describe("with motion", () => {
  // Turn motion back on: the pulse never runs with reduced motion (the suite's default).
  test.use({ reducedMotion: "no-preference" });

  test("a pulse fires within 12 s of load, splits at the witness lines, and ends", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/");
    await page.waitForFunction(() => (window.__crate?.getState().frames ?? 0) > 0, undefined, { timeout: 30_000 });
    await pollCrate(page, (s) => s.pulses, { timeout: 12_000 }).toBeGreaterThan(0);

    await openApp(page);
    // Closed mode: three crate dimensions. Past the first vertex there are up to 6 photons each.
    const before = (await crate(page)).pulses;
    await photonsOnScreen(page, 7, 40_000);
    await shot(page, "22-pulse-closed");
    expect((await crate(page)).pulses).toBeGreaterThan(before);
    // Each photon fades at its end: nothing is left on screen after the pulse.
    await pollCrate(page, (s) => s.photonsActive).toBe(0);

    // Exploded: the photons ride the moved-out lines, and the part's dimensions pulse too.
    await modeButton(page).click();
    await modeButton(page).click();
    await pollCrate(page, (s) => s.mode).toBe("exploded");
    await pollCrate(page, (s) => s.anim.explode).toBe(1);
    await page.getByRole("banner").getByRole("heading", { name: "Crate Designer" }).hover();
    // The clock takes frame steps of at most 0.1 s (as `Director`), so at SwiftShader's few frames
    // a second the 10 s period runs long: allow two periods.
    await photonsOnScreen(page, 7, 40_000);
    await shot(page, "22-pulse-exploded");
  });

  test("no pulse with size labels off", async ({ page }) => {
    test.setTimeout(60_000);
    await openApp(page);
    await viewButton(page).click();
    const id = await viewButton(page).getAttribute("aria-controls");
    await page.locator(`[id="${id}"]`).getByLabel("Size labels", { exact: true }).uncheck();
    await pollCrate(page, (s) => s.view.dims).toBe(false);
    const fired = (await crate(page)).pulses;
    await page.waitForTimeout(12_000);
    const s = await crate(page);
    expect(s.pulses).toBe(fired);
    expect(s.photonsActive).toBe(0);
  });
});

test("no pulse with reduced motion", async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  await page.waitForTimeout(12_000);
  const s = await crate(page);
  expect(s.pulses).toBe(0);
  expect(s.photonsActive).toBe(0);
});

import { expect, test, type Page } from "@playwright/test";
import { crate, explode, header, openApp, openViewPopover, pollCrate, shot } from "./helpers";

/**
 * Dimension-line photon pulse: about every 10 s (the first 2 s after the crate frames), photons leave each
 * size label and run out along the dimension. Read through the test hook's `pulses` (fired) and
 * `photonsActive` (on screen this frame). The pulse clock steps by animation frames (at most 0.1 s each), so
 * under software WebGL the wall-clock period stretches; every wait here is on a probe value, not a sleep.
 */

/** Waits (checking every animation frame) until at least `n` photons are on screen. */
const photonsOnScreen = (page: Page, n = 1, timeout = 40_000) =>
  page.waitForFunction((min) => (window.__crate?.getState().photonsActive ?? 0) >= min, n, { timeout, polling: "raf" });

/**
 * A quiet period long enough to contain a pulse if one were coming: a full 10 s period of wall time and at
 * least 100 frames (the clock's worst-case step is 0.1 s). A negative assertion needs time to pass; this is
 * the time it needs, and it stretches on a slow machine instead of ending early.
 */
const quietPeriod = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const t0 = performance.now();
        const f0 = window.__crate!.getState().frames;
        const tick = () => (performance.now() - t0 >= 12_000 && window.__crate!.getState().frames - f0 >= 100 ? resolve() : requestAnimationFrame(tick));
        tick();
      }),
  );

test.describe("with motion", () => {
  // Turn motion back on: the pulse never runs with reduced motion (the suite's default).
  test.use({ reducedMotion: "no-preference" });

  test("a pulse fires after the crate frames, splits at the witness lines, and ends", async ({ page }) => {
    test.setTimeout(150_000);
    await openApp(page);
    await pollCrate(page, (s) => s.pulses, { timeout: 40_000 }).toBeGreaterThan(0);

    // Closed mode: three crate dimensions. Past the first vertex there are up to 6 photons each.
    const before = (await crate(page)).pulses;
    await photonsOnScreen(page, 7);
    await shot(page, "dimension-pulse-closed");
    expect((await crate(page)).pulses).toBeGreaterThanOrEqual(before);
    // Each photon fades at its end: nothing is left on screen after the pulse.
    await pollCrate(page, (s) => s.photonsActive, { timeout: 40_000 }).toBe(0);

    // Exploded: the photons ride the moved-out lines, and the part's dimensions pulse too.
    await explode(page);
    await header(page).getByRole("heading", { name: "Crate Designer" }).hover();
    await photonsOnScreen(page, 7);
    await shot(page, "dimension-pulse-exploded");
  });

  test("no pulse with size labels off", async ({ page }) => {
    test.setTimeout(120_000);
    await openApp(page);
    // The control: with labels on, a pulse does fire on this page.
    await pollCrate(page, (s) => s.pulses, { timeout: 40_000 }).toBeGreaterThan(0);
    const pop = await openViewPopover(page);
    await pop.getByLabel("Size labels", { exact: true }).uncheck();
    await pollCrate(page, (s) => s.view.dims).toBe(false);
    await pollCrate(page, (s) => s.photonsActive).toBe(0);
    const fired = (await crate(page)).pulses;
    await quietPeriod(page);
    const s = await crate(page);
    expect(s.pulses).toBe(fired);
    expect(s.photonsActive).toBe(0);
  });
});

test("no pulse with reduced motion", async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  await quietPeriod(page);
  const s = await crate(page);
  expect(s.pulses).toBe(0);
  expect(s.photonsActive).toBe(0);
});

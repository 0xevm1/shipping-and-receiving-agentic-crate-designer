import { expect, test, type Page } from "@playwright/test";
import { crate, island, openApp, pollCrate } from "./helpers";

/**
 * #64: hovering never stops idle auto-play; a deliberate action (click, drag, wheel, key) does.
 * Hover-only movement over empty canvas, the boards and the island keeps the page idle; one
 * click stops it, and it resumes after `IDLE_MS` (5 s).
 */
test.use({ reducedMotion: "no-preference" });

const HOVER_MS = 8_000;

/** Centre of the free area left of the island, where the crate sits. */
async function crateCentre(page: Page) {
  const box = (await island(page).boundingBox())!;
  const vp = page.viewportSize()!;
  return { x: box.x / 2, y: vp.height / 2 };
}

test("hover-only movement keeps the crate turning, a click stops it", async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  // Nothing has been clicked or typed since load, so auto-play is already running.
  await pollCrate(page, (s) => s.autoplay, { timeout: 15_000 }).toBe(true);
  const theta0 = (await crate(page)).cameraAngles!.theta;

  const c = await crateCentre(page);
  const bar = island(page).locator(".barrow").first();
  // The bars sit low in the Overview; a scripted scroll fires no wheel event, so it isn't input.
  await bar.scrollIntoViewIfNeeded();
  const barBox = (await bar.boundingBox())!;
  const started = Date.now();
  let step = 0;
  let boardHovered = false;
  let islandHovered = false;
  while (Date.now() - started < HOVER_MS) {
    const phase = Math.floor(((Date.now() - started) / HOVER_MS) * 3);
    const a = step++ * 0.5;
    if (phase === 0) {
      // Circles over the crate: crosses boards and the empty canvas around them.
      await page.mouse.move(c.x + Math.cos(a) * 160, c.y + Math.sin(a) * 160, { steps: 4 });
    } else if (phase === 1) {
      // Circles over empty canvas, well away from the crate.
      await page.mouse.move(80 + Math.cos(a) * 40, 120 + Math.sin(a) * 40, { steps: 4 });
    } else {
      // Over the island's weight bars (an island hover highlights in 3D).
      await page.mouse.move(barBox.x + barBox.width / 2 + Math.cos(a) * 30, barBox.y + barBox.height / 2, { steps: 4 });
    }
    const s = await crate(page);
    expect(s.autoplay, `auto-play stopped by hover at ${Date.now() - started} ms`).toBe(true);
    expect(s.idle).toBe(true);
    if (s.hoverKey) boardHovered = true;
    if (s.hoverAssembly) islandHovered = true;
  }
  expect(boardHovered, "the pointer crossed a board").toBe(true);
  expect(islandHovered, "the pointer hovered a weight bar").toBe(true);
  // Still turning: the camera kept moving through all of it (headless frames are slow and
  // dt is capped, so well under the nominal 0.18 rad/s × 8 s).
  const turned = Math.abs((await crate(page)).cameraAngles!.theta - theta0);
  expect(turned).toBeGreaterThan(0.1);

  // One click on empty canvas stops it at once.
  await page.mouse.click(80, 120);
  const clicked = Date.now();
  const after = await crate(page);
  expect(after.autoplay).toBe(false);
  expect(after.idle).toBe(false);

  // It resumes after IDLE_MS (5 s) without deliberate input, hovering the whole time.
  await page.mouse.move(c.x, c.y, { steps: 5 });
  await pollCrate(page, (s) => s.autoplay, { timeout: 20_000 }).toBe(true);
  const waited = Date.now() - clicked;
  expect(waited).toBeGreaterThan(4_000);
  expect(waited).toBeLessThan(15_000);
});

test("a drag, the wheel and a key each stop it", async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  const c = await crateCentre(page);

  const stops = async (name: string, act: () => Promise<void>) => {
    await pollCrate(page, (s) => s.autoplay, { timeout: 20_000 }).toBe(true);
    await act();
    await expect.poll(async () => (await crate(page)).autoplay, { message: name }).toBe(false);
  };
  await stops("wheel", async () => {
    await page.mouse.move(c.x, c.y);
    await page.mouse.wheel(0, 100);
  });
  await stops("key", () => page.keyboard.press("Shift"));
  await stops("drag", async () => {
    await page.mouse.move(c.x - 100, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 100, c.y, { steps: 10 });
    await page.mouse.up();
  });
});

test("the hover tooltip follows the turning crate", async ({ page }) => {
  await openApp(page);
  await pollCrate(page, (s) => s.autoplay, { timeout: 15_000 }).toBe(true);
  const c = await crateCentre(page);
  // Hold the pointer still on the crate; the boards move under it while it turns.
  await page.mouse.move(c.x, c.y + 40, { steps: 5 });
  await pollCrate(page, (s) => s.hoverKey, { timeout: 10_000 }).not.toBeNull();
  const tip = page.locator(".tip");
  await expect(tip).toBeVisible();
  // Re-picked under the still pointer: the hovered board changes as the crate turns.
  const first = (await crate(page)).hoverKey;
  await pollCrate(page, (s) => s.hoverKey !== null && s.hoverKey !== first, { timeout: 30_000 }).toBe(true);
  expect((await crate(page)).autoplay).toBe(true);
  await expect(tip).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/64-idle-hover/hover-while-turning.png" });
});

import { expect, test, type Page } from "@playwright/test";
import { crate, island, openApp, panel, pollCrate, screenBox, shot } from "./helpers";

/**
 * Idle auto-play: hovering never stops it, nor does anything done in the island or header; a click, drag or wheel on the 3D view does. Hover-only
 * movement over empty canvas, the boards and the island keeps the page idle; one click stops it, and it
 * resumes after `IDLE_MS` (5 s). Motion is turned back on, because auto-play never runs with reduced motion.
 */
test.use({ reducedMotion: "no-preference" });

/** Hover steps per phase: over the crate, over empty canvas, over the island's weight bars. */
const STEPS_PER_PHASE = 15;

/** Centre of the free area left of the island, where the crate sits. */
async function crateCentre(page: Page) {
  const box = await screenBox(island(page));
  const vp = page.viewportSize()!;
  return { x: box.left / 2, y: vp.height / 2 };
}

test("hover-only movement keeps the crate turning, a click stops it, and it resumes after 5 s", async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  // Nothing has been clicked or typed since load, so auto-play is already running.
  await pollCrate(page, (s) => s.autoplay, { timeout: 15_000 }).toBe(true);
  const theta0 = (await crate(page)).cameraAngles!.theta;

  const c = await crateCentre(page);
  const bar = panel(page).getByTestId("weight-bar").first();
  // The bars sit low in the Overview; a scripted scroll fires no wheel event, so it isn't input.
  await bar.scrollIntoViewIfNeeded();
  const barBox = (await bar.boundingBox())!;
  let boardHovered = false;
  let islandHovered = false;
  for (let step = 0; step < STEPS_PER_PHASE * 3; step++) {
    const phase = Math.floor(step / STEPS_PER_PHASE);
    const a = step * 0.5;
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
    expect(s.autoplay, `auto-play stopped by hover at step ${step}`).toBe(true);
    expect(s.idle).toBe(true);
    if (s.hoverKey) boardHovered = true;
    if (s.hoverAssembly) islandHovered = true;
  }
  expect(boardHovered, "the pointer crossed a board").toBe(true);
  expect(islandHovered, "the pointer hovered a weight bar").toBe(true);
  // Still turning: the camera kept moving through all of it (headless frames are slow and dt is capped).
  await pollCrate(page, (s) => Math.abs(s.cameraAngles!.theta - theta0)).toBeGreaterThan(0.1);

  // One click on empty canvas (clear of the header block, which is not the 3D view) stops it at once.
  await page.mouse.click(120, 620);
  const clicked = Date.now();
  const after = await crate(page);
  expect(after.autoplay).toBe(false);
  expect(after.idle).toBe(false);

  // It resumes after IDLE_MS (5 s) without deliberate input, hovering the whole time.
  await page.mouse.move(c.x, c.y, { steps: 5 });
  await pollCrate(page, (s) => s.autoplay, { timeout: 20_000 }).toBe(true);
  const waited = Date.now() - clicked;
  // The lower bound allows for the poll's timing; the upper one for slow frames.
  expect(waited).toBeGreaterThan(4_000);
  expect(waited).toBeLessThan(15_000);
});

test("a drag and the wheel on the canvas each stop it", async ({ page }) => {
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
  await stops("drag", async () => {
    await page.mouse.move(c.x - 100, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 100, c.y, { steps: 10 });
    await page.mouse.up();
  });
});

test("clicks in the header and the island, and a key outside the view, leave it turning; the mode button stops it", async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page);
  await pollCrate(page, (s) => s.autoplay, { timeout: 15_000 }).toBe(true);

  await page.getByRole("banner").getByRole("heading", { name: "Crate Designer" }).click();
  await page.getByRole("tab", { name: "Rules" }).click();
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.keyboard.press("Shift");
  const s = await crate(page);
  expect(s.autoplay, "still turning after header, tab and key input").toBe(true);
  expect(s.idle).toBe(true);

  // A control that sets the view counts as input on the view.
  await page.getByRole("button", { name: /view\. Click for/ }).click();
  await pollCrate(page, (c) => c.autoplay).toBe(false);
});

test("the hover tooltip follows the turning crate", async ({ page }) => {
  await openApp(page);
  await pollCrate(page, (s) => s.autoplay, { timeout: 15_000 }).toBe(true);
  const c = await crateCentre(page);
  // Hold the pointer still on the crate; the boards move under it while it turns.
  await page.mouse.move(c.x, c.y + 40, { steps: 5 });
  await pollCrate(page, (s) => s.hoverKey, { timeout: 10_000 }).not.toBeNull();
  const tip = page.getByTestId("hover-tip");
  await expect(tip).toBeVisible();
  // Re-picked under the still pointer: the hovered board changes as the crate turns.
  const first = (await crate(page)).hoverKey;
  await pollCrate(page, (s) => s.hoverKey !== null && s.hoverKey !== first, { timeout: 30_000 }).toBe(true);
  expect((await crate(page)).autoplay).toBe(true);
  await expect(tip).toBeVisible();
  await shot(page, "idle-autoplay-hover-while-turning");
});

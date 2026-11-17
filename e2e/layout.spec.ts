import { expect, test, type Page } from "@playwright/test";
import {
  crate,
  hidePanelsButton,
  island,
  openApp,
  openTab,
  panel,
  pollCrate,
  reloadApp,
  screenBox,
  setQuantity,
  shot,
  showPanelsButton,
  type ScreenBox,
} from "./helpers";

/**
 * Where things sit on a desktop window (the narrow drawer layout is in layout.narrow.spec.ts and
 * layout.mobile.spec.ts). Only the island panel scrolls, and the crate sits in the free area the island
 * leaves (left of it), not the middle of the window: at load, after a reload that restores the last
 * design, after Hide / Show panels, and after a resize across the narrow breakpoint and back.
 * `crateScreen` is the closed crate's outside box projected through the live camera.
 */

test("at 1440 × 900 only the island panel scrolls", async ({ page }) => {
  await openApp(page);
  await openTab(page, "Cut list");

  const doc = await page.evaluate(() => {
    const el = document.scrollingElement!;
    return { scrollH: el.scrollHeight, scrollW: el.scrollWidth, h: window.innerHeight, w: window.innerWidth };
  });
  expect(doc.scrollH).toBeLessThanOrEqual(doc.h);
  expect(doc.scrollW).toBeLessThanOrEqual(doc.w);

  // The cut list is longer than the panel, and the panel scrolls it.
  const p = panel(page);
  await expect(p).toHaveCSS("overflow-y", "auto");
  const sizes = await p.evaluate((el) => ({ scrollH: el.scrollHeight, h: el.clientHeight }));
  expect(sizes.scrollH).toBeGreaterThan(sizes.h);
  await p.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  expect(await p.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await shot(page, "layout-panel-scrolled");
});

/** Waits for the camera to settle (the crate's box stops moving), then returns it. */
async function settledBox(page: Page): Promise<ScreenBox> {
  let last = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify((await crate(page)).crateScreen);
        const same = now === last;
        last = now;
        return same;
      },
      { timeout: 15_000, intervals: [300] },
    )
    .toBe(true);
  return (await crate(page)).crateScreen!;
}

/** The crate's projected centre is in the free area, and no part of its box is under the island. */
async function expectInFreeArea(page: Page, label: string) {
  const box = await settledBox(page);
  const isl = await screenBox(island(page));
  const cx = (box.left + box.right) / 2;
  expect(cx, `${label}: crate centre x ${Math.round(cx)} is left of the island at ${Math.round(isl.left)}`).toBeLessThan(isl.left);
  expect(box.right, `${label}: crate box right ${Math.round(box.right)} is clear of the island at ${Math.round(isl.left)}`).toBeLessThanOrEqual(isl.left);
  expect(box.left, `${label}: crate box is on screen`).toBeGreaterThanOrEqual(0);
}

for (const [width, height] of [
  [1440, 900],
  [1280, 720],
]) {
  test(`the crate sits in the free area at load, at ${width} × ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openApp(page);
    await expectInFreeArea(page, `load ${width}×${height}`);
    await shot(page, `layout-free-area-${width}`);
  });
}

test("the crate is in the free area after a reload that restores the last design", async ({ page }) => {
  test.slow();
  await openApp(page);
  await setQuantity(page, 8);
  // The save is debounced: wait for it to land (the stored design holds the new quantity).
  await page.waitForFunction(() => {
    const text = localStorage.getItem("crate-designer.last-design.v1");
    return text !== null && JSON.parse(text).design.settings.quantity === 8;
  });
  await reloadApp(page);
  await pollCrate(page, (s) => s.quantity).toBe(8);
  await expectInFreeArea(page, "after restore");
});

test("after Hide panels the crate may use the whole window; Show panels puts it back in the free area", async ({ page }) => {
  await openApp(page);
  await hidePanelsButton(page).click();
  await pollCrate(page, (s) => s.panelsHidden).toBe(true);
  const hidden = await settledBox(page);
  // With the panels gone the crate may use the whole window, centred.
  expect((hidden.left + hidden.right) / 2).toBeGreaterThan(300);
  await showPanelsButton(page).click();
  await pollCrate(page, (s) => s.panelsHidden).toBe(false);
  await expectInFreeArea(page, "after Show panels");
});

test("after a resize across the narrow breakpoint and back", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await page.setViewportSize({ width: 800, height: 900 });
  await pollCrate(page, (s) => s.drawerOpen).toBe(false);
  await settledBox(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectInFreeArea(page, "back to 1440");
  // A short, narrower desktop window: the closed crate is framed close, so only its centre is asserted.
  await page.setViewportSize({ width: 1100, height: 700 });
  const box = await settledBox(page);
  const isl = await screenBox(island(page));
  expect((box.left + box.right) / 2, "resized to 1100×700: crate centre is left of the island").toBeLessThan(isl.left);
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the idle turn keeps the crate in the free area", async ({ page }) => {
    test.slow();
    await openApp(page);
    await pollCrate(page, (s) => s.autoplay, { timeout: 20_000 }).toBe(true);
    const turned = (await crate(page)).cameraAngles!.theta;
    // Sample the crate as it turns: each time the camera has moved on, the crate is still beside the island.
    for (let i = 0; i < 4; i++) {
      const box = (await crate(page)).crateScreen!;
      const isl = await screenBox(island(page));
      expect((box.left + box.right) / 2, `idle turn, sample ${i}`).toBeLessThan(isl.left);
      const theta = (await crate(page)).cameraAngles!.theta;
      await pollCrate(page, (s) => Math.abs(s.cameraAngles!.theta - theta)).toBeGreaterThan(0.02);
    }
    expect(Math.abs((await crate(page)).cameraAngles!.theta - turned)).toBeGreaterThan(0.05);
  });
});

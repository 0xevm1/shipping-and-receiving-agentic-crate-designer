import { expect, test, type Page } from "@playwright/test";
import { crate, island, openApp, openTab, panel, pollCrate, shot } from "./helpers";

/**
 * The crate sits in the free area the island leaves (left of it on desktop), not the middle of
 * the window: at load, after a reload that restores the last design, after Hide / Show panels,
 * and after a resize across the narrow breakpoint and back. `crateScreen` is the closed crate's
 * outside box projected through the live camera.
 */

type Box = { left: number; top: number; right: number; bottom: number };

const islandBox = async (page: Page): Promise<Box> => {
  const b = (await island(page).boundingBox())!;
  return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
};

/** Waits for the camera to settle (the crate's box stops moving), then returns it. */
async function settledBox(page: Page): Promise<Box> {
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
  const isl = await islandBox(page);
  const cx = (box.left + box.right) / 2;
  expect(cx, `${label}: crate centre x ${Math.round(cx)} is left of the island at ${Math.round(isl.left)}`).toBeLessThan(isl.left);
  expect(box.right, `${label}: crate box right ${Math.round(box.right)} is clear of the island at ${Math.round(isl.left)}`).toBeLessThanOrEqual(isl.left);
  expect(box.left, `${label}: crate box is on screen`).toBeGreaterThanOrEqual(0);
}

test("at load, at 1440 × 900", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await expectInFreeArea(page, "load 1440×900");
  await shot(page, "30-free-area-1440");
});

test("at load, at 1280 × 720", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page);
  await expectInFreeArea(page, "load 1280×720");
  await shot(page, "30-free-area-1280");
});

test("after a reload that restores the last design", async ({ page }) => {
  test.slow();
  await openApp(page);
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill("8");
  await pollCrate(page, (s) => s.quantity).toBe(8);
  // The save is debounced: wait for it to land.
  await page.waitForFunction(() => localStorage.getItem("crate-designer.last-design.v1") !== null, undefined, { timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForFunction(() => (window.__crate?.getState().frames ?? 0) > 3, undefined, { timeout: 30_000 });
  await pollCrate(page, (s) => s.quantity).toBe(8);
  await expectInFreeArea(page, "after restore");
});

test("after Hide panels and Show panels", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Hide panels" }).click();
  await pollCrate(page, (s) => s.panelsHidden).toBe(true);
  const hidden = await settledBox(page);
  // With the panels gone the crate may use the whole window, centred.
  expect((hidden.left + hidden.right) / 2).toBeGreaterThan(300);
  await page.getByRole("button", { name: "Show panels" }).click();
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
  const isl = await islandBox(page);
  expect((box.left + box.right) / 2, "resized to 1100×700: crate centre is left of the island").toBeLessThan(isl.left);
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the idle turn keeps the crate in the free area", async ({ page }) => {
    test.slow();
    await openApp(page);
    await pollCrate(page, (s) => s.autoplay, { timeout: 20_000 }).toBe(true);
    for (let i = 0; i < 4; i++) {
      const box = (await crate(page)).crateScreen!;
      const isl = await islandBox(page);
      expect((box.left + box.right) / 2, `idle turn, sample ${i}`).toBeLessThan(isl.left);
      await page.waitForTimeout(700);
    }
  });
});

import { expect, test, type Page } from "@playwright/test";
import { crate, openApp, pollCrate, shot } from "./helpers";

/**
 * Panning the main canvas: right-drag moves the view, bounded so the crate can't be lost; it
 * counts as deliberate input; a camera preset (View > 3D) or, once idle auto-play starts, the
 * idle turn brings it back to the middle. The touch gesture is in 30-pan.mobile.spec.ts.
 */

type Vec = [number, number, number];

const canvasBox = async (page: Page) => (await page.locator(".stage canvas").first().boundingBox())!;

/** Right-button drag by (dx, dy) px from the canvas's middle left. */
async function rightDrag(page: Page, dx: number, dy: number) {
  const b = await canvasBox(page);
  const x = b.x + b.width * 0.3;
  const y = b.y + b.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up({ button: "right" });
}

const distance = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const home = (outside: Vec): Vec => [0, outside[2] / 2 / 1000, 0];

async function choosePreset(page: Page, name: string) {
  const view = page.getByRole("button", { name: "View", exact: true });
  await view.click();
  const pop = page.locator(`[id="${await view.getAttribute("aria-controls")}"]`);
  await pop.getByRole("button", { name, exact: true }).click();
  await page.keyboard.press("Escape");
}

test("the View popover names the gestures", async ({ page }) => {
  await openApp(page);
  const view = page.getByRole("button", { name: "View", exact: true });
  await expect(view).toHaveAttribute("title", /right-drag to pan/);
  await view.click();
  const pop = page.locator(`[id="${await view.getAttribute("aria-controls")}"]`);
  await expect(pop).toContainText("right-drag to pan");
  // Nothing floats over the stage.
  await expect(page.getByTestId("view-hint")).toHaveCount(0);
});

test("a right-drag pans the view, and counts as deliberate input", async ({ page }) => {
  await openApp(page);
  const before = await crate(page);
  const box0 = before.crateScreen!;
  await rightDrag(page, 160, -60);
  const after = await crate(page);
  expect(distance(after.cameraTarget!, before.cameraTarget!), "the orbit target moved").toBeGreaterThan(0.05);
  // The crate moved with the drag, rather than turning on the spot.
  expect((await crate(page)).crateScreen!.left).toBeGreaterThan(box0.left + 40);
  expect(after.idle, "a drag is deliberate input").toBe(false);
  expect(after.view.camera).toBeNull();
  await shot(page, "30-panned");
});

for (const [width, height] of [
  [1440, 900],
  [1280, 720],
]) {
  test(`panning can't drag the crate under the island, the header or off screen (${width} × ${height})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openApp(page);
    const isl = (await page.getByRole("complementary").boundingBox())!;
    // Drag hard in every direction, twice each: toward the island, away from it, up and down.
    for (const [dx, dy] of [
      [700, 0],
      [700, 200],
      [-700, 0],
      [0, -500],
      [0, 500],
      [700, -300],
    ]) {
      await rightDrag(page, dx, dy);
      await rightDrag(page, dx, dy);
      await page.waitForTimeout(200);
      const box = (await crate(page)).crateScreen!;
      const cx = (box.left + box.right) / 2;
      const cy = (box.top + box.bottom) / 2;
      expect(cx, `after dragging by (${dx}, ${dy}): centre x ${Math.round(cx)} is left of the island at ${Math.round(isl.x)}`).toBeLessThan(isl.x);
      expect(cx).toBeGreaterThan(0);
      // The island starts at the top of the window, so the header side is the left and top edges.
      expect(cy).toBeGreaterThan(0);
      expect(cy).toBeLessThan(height);
      expect(box.left, "not pushed off the left edge").toBeGreaterThan(-0.2 * width);
      // A crate that fits the free area is wholly clear of the island, not just centred beside it.
      if (box.right - box.left <= isl.x - 28 - 40) expect(box.right, `after (${dx}, ${dy}): box right ${Math.round(box.right)} is clear of the island`).toBeLessThanOrEqual(isl.x);
    }
    const final = await crate(page);
    expect(final.idle).toBe(false);
  });
}

test("a camera preset brings a panned view back to the middle", async ({ page }) => {
  await openApp(page);
  const outside = (await crate(page)).outside!;
  await rightDrag(page, 200, 80);
  expect(distance((await crate(page)).cameraTarget!, home(outside))).toBeGreaterThan(0.05);
  await choosePreset(page, "3D");
  await pollCrate(page, (s) => distance(s.cameraTarget!, home(outside)), { timeout: 10_000 }).toBeLessThan(0.01);
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("when the idle turn starts it eases a panned view back to the middle, keeping the zoom", async ({ page }) => {
    test.slow();
    await openApp(page);
    const outside = (await crate(page)).outside!;
    await rightDrag(page, 200, 80);
    const panned = await crate(page);
    expect(distance(panned.cameraTarget!, home(outside))).toBeGreaterThan(0.05);
    await pollCrate(page, (s) => s.autoplay, { timeout: 20_000 }).toBe(true);
    await pollCrate(page, (s) => distance(s.cameraTarget!, home(outside)), { timeout: 10_000 }).toBeLessThan(0.02);
  });
});

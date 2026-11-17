import { expect, test, type Page } from "@playwright/test";
import { crate, openApp, pollCrate, shot } from "./helpers";

/**
 * Panning the main canvas: right-drag moves the view, bounded so the crate can't be lost; it
 * counts as deliberate input; a camera preset (View > 3D) or, once idle auto-play starts, the
 * idle turn brings it back to the middle. The touch gesture is in 30-pan.mobile.spec.ts.
 */

const PAN_LIMIT = 0.75; // framing.ts: share of the crate's longest side
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

test("the view hint names the gestures", async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId("view-hint")).toContainText("right-drag to pan");
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

test("panning is bounded: the crate can't be dragged out of sight", async ({ page }) => {
  await openApp(page);
  const outside = (await crate(page)).outside!;
  for (let i = 0; i < 4; i++) await rightDrag(page, 700, 300);
  const s = await crate(page);
  const limit = (Math.max(...outside) / 1000) * PAN_LIMIT;
  expect(distance(s.cameraTarget!, home(outside))).toBeLessThanOrEqual(limit + 1e-3);
  expect(distance(s.cameraTarget!, home(outside)), "it did reach the limit").toBeGreaterThan(limit * 0.9);
  // Some of the crate is still on screen.
  const b = s.crateScreen!;
  const canvas = await canvasBox(page);
  expect(b.right).toBeGreaterThan(0);
  expect(b.left).toBeLessThan(canvas.width);
});

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

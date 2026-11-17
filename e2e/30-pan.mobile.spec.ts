import { expect, test } from "@playwright/test";
import { crate, openApp, pollCrate } from "./helpers";

/** Two-finger pan on the main canvas at phone sizes (mobile-390 and mobile-360). */

test("a two-finger drag pans the view, and one finger still turns it", async ({ page }) => {
  await openApp(page);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: { x: number; y: number }[]) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : points.map((p, id) => ({ ...p, id })) });

  const before = await crate(page);
  // Two fingers a fixed distance apart (no pinch), moving together.
  const y = 300;
  const x = 150;
  await touch("touchStart", [{ x, y }, { x: x + 60, y }]);
  for (let i = 1; i <= 8; i++) await touch("touchMove", [{ x: x + i * 8, y: y + i * 4 }, { x: x + 60 + i * 8, y: y + i * 4 }]);
  await touch("touchEnd", []);

  await pollCrate(
    page,
    (s) => Math.hypot(...s.cameraTarget!.map((v, i) => v - before.cameraTarget![i])),
    { timeout: 5000 },
  ).toBeGreaterThan(0.02);
  const after = await crate(page);
  expect(after.idle).toBe(false);
  // The distance to the target is unchanged: it was a pan, not a pinch.
  expect(after.cameraDistance!).toBeCloseTo(before.cameraDistance!, 1);

  // One finger turns the crate about the (moved) target.
  const turned = after.cameraAngles!.theta;
  await touch("touchStart", [{ x: 150, y: 400 }]);
  for (let i = 1; i <= 8; i++) await touch("touchMove", [{ x: 150 + i * 10, y: 400 }]);
  await touch("touchEnd", []);
  await pollCrate(page, (s) => Math.abs(s.cameraAngles!.theta - turned)).toBeGreaterThan(0.1);
});

test("the View popover shows the touch wording", async ({ page }) => {
  await openApp(page);
  const view = page.getByRole("button", { name: "View", exact: true });
  await view.click();
  const pop = page.locator(`[id="${await view.getAttribute("aria-controls")}"]`);
  await expect(pop.locator(".hint-touch")).toBeVisible();
  await expect(pop.locator(".hint-touch")).toContainText("two fingers to pan");
  await expect(page.getByTestId("view-hint")).toHaveCount(0);
});

import { expect, test } from "@playwright/test";
import { burger, drawer, expectNoPageScroll, hidePanelsButton, openApp, openDrawer, openTab, panel, screenBox, shot, stage, summary } from "./helpers";

// Narrow project (900 × 900, mouse): below 980 px the island is a drawer (spec §8.2).
// Phones are covered in drawer.mobile.spec.ts and layout.mobile.spec.ts.
test("at 900 px the scene is full-bleed and the island is a drawer", async ({ page }) => {
  await openApp(page);

  // Full-bleed canvas; summary and view bar share the bottom row; no Hide panels.
  const box = (await stage(page).boundingBox())!;
  expect(box).toMatchObject({ x: 0, y: 0, width: 900, height: 900 });
  expect(await page.evaluate(() => window.__crate!.canvasCoverage())).toBeGreaterThan(0.05);
  const chip = await screenBox(summary(page));
  const units = await screenBox(page.getByRole("group", { name: "Units" }));
  expect(Math.abs(chip.bottom - units.bottom)).toBeLessThan(12);
  await expect(hidePanelsButton(page)).toBeHidden();
  await expectNoPageScroll(page);

  // The drawer opens from the hamburger with a mouse too, and holds every tab.
  await openDrawer(page, "click");
  expect((await drawer(page).boundingBox())!.width).toBeLessThanOrEqual(441);
  for (const name of ["Overview", "Layouts", "Cut list", "Rules", "Checks"]) {
    await openTab(page, name);
    await expect(panel(page)).toBeVisible();
    await expectNoPageScroll(page);
  }
  await openTab(page, "Overview");
  await shot(page, "layout-narrow-drawer");

  // Clicking the scrim closes it.
  await page.mouse.click(40, 450);
  await expect(drawer(page)).toBeHidden();
  await expect(burger(page)).toBeFocused();
});

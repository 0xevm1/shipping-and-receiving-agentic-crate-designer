import { expect, test } from "@playwright/test";
import { openApp, openTab, panel, shot } from "./helpers";

// Narrow project (900 × 900, mouse): below 980 px the island is a drawer (spec §8.2, #42).
// Phones are covered in 12-mobile.mobile.spec.ts.
test("at 900 px the scene is full-bleed and the island is a drawer", async ({ page }) => {
  await openApp(page);

  const noScroll = async () => {
    const d = await page.evaluate(() => ({
      h: document.scrollingElement!.scrollHeight - window.innerHeight,
      w: document.scrollingElement!.scrollWidth - window.innerWidth,
    }));
    expect(d.h).toBeLessThanOrEqual(0);
    expect(d.w).toBeLessThanOrEqual(0);
  };

  // Full-bleed canvas; summary and view bar share the bottom row; no Hide panels.
  const stage = (await page.getByRole("region", { name: "3D view of the crate" }).boundingBox())!;
  expect(stage).toMatchObject({ x: 0, y: 0, width: 900, height: 900 });
  expect(await page.evaluate(() => window.__crate!.canvasCoverage())).toBeGreaterThan(0.05);
  const summary = (await page.locator(".summary").boundingBox())!;
  const units = (await page.getByRole("group", { name: "Units" }).boundingBox())!;
  expect(Math.abs(summary.y + summary.height - (units.y + units.height))).toBeLessThan(12);
  await expect(page.getByRole("button", { name: "Hide panels" })).toBeHidden();
  await noScroll();

  // The drawer opens from the hamburger with a mouse too, and holds every tab.
  const burger = page.getByRole("button", { name: "Crate details" });
  await burger.click();
  const drawer = page.getByRole("dialog", { name: "Crate details" });
  await expect(drawer).toBeVisible();
  expect((await drawer.boundingBox())!.width).toBeLessThanOrEqual(441);
  for (const name of ["Overview", "Layouts", "Cut list", "Rules", "Checks"]) {
    await openTab(page, name);
    await expect(panel(page)).toBeVisible();
    await noScroll();
  }
  await openTab(page, "Overview");
  await shot(page, "08-narrow-drawer");

  // Clicking the scrim closes it.
  await page.mouse.click(40, 450);
  await expect(drawer).toBeHidden();
  await expect(burger).toBeFocused();
});

import { expect, test, type Page } from "@playwright/test";
import { openApp, openTab, panel, setUnits, shot } from "./helpers";

/**
 * UI review, text and data items (#62): check messages follow the units toggle, a part's mass
 * has one rounding rule, and the print link uses the share link's `design` parameter.
 */

test.beforeEach(async ({ context }) => {
  // Never open a real print dialog (applies to the print tab too).
  await context.addInitScript(() => {
    window.print = () => {};
  });
});

const checks = (page: Page) => panel(page).locator(".check");

test("imperial check messages carry no mm or kg, metric keeps them", async ({ page }) => {
  await openApp(page);
  await setUnits(page, "imperial");
  await openTab(page, "Checks");
  await expect(checks(page).filter({ hasText: "dry van" })).toContainText("98.0 in × 108.0 in door");
  const imperial = await checks(page).allInnerTexts();
  expect(imperial.length).toBeGreaterThan(5);
  for (const text of imperial) expect(text).not.toMatch(/\bmm\b|\bkg\b/);
  await expect(panel(page)).toContainText(/Base rated [\d,]+ lb/);
  await shot(page, "28-checks-imperial");

  await setUnits(page, "metric");
  await expect(checks(page).filter({ hasText: "dry van" })).toContainText("2,489 mm × 2,743 mm door");
  await expect(panel(page)).toContainText(/Base rated [\d,]+ kg/);
  await shot(page, "28-checks-metric");
});

test("a part's mass reads the same in the header and Overview", async ({ page }) => {
  await openApp(page);
  await setUnits(page, "imperial");
  await expect(page.getByRole("banner")).toContainText("47.4 lb each");
  await expect(panel(page)).toContainText("47.4 lb");
  await shot(page, "28-mass-overview");
});

test("the print link uses the design parameter, and an old d link still opens", async ({ page }) => {
  await openApp(page);
  await setUnits(page, "imperial");
  await openTab(page, "Cut list");
  const [popup] = await Promise.all([page.waitForEvent("popup"), panel(page).getByRole("button", { name: "Print / save PDF" }).click()]);
  expect(popup.url()).toMatch(/\/print#design=[A-Za-z0-9_-]+&u=imperial&print=1$/);
  const spec = popup.getByRole("region", { name: "Crate spec" });
  await expect(spec).toBeVisible();
  await expect(spec.locator("table.checks")).not.toContainText(/\bmm\b|\bkg\b/);
  await popup.setViewportSize({ width: 1000, height: 1400 });
  await spec.screenshot({ path: "e2e/screenshots/28-print-spec-imperial.png" });

  const legacy = popup.url().replace("#design=", "#d=");
  await popup.goto("about:blank");
  await popup.goto(legacy);
  await expect(popup.getByRole("region", { name: "Crate spec" })).toBeVisible();
});

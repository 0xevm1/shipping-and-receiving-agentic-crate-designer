import { expect, test, type Locator, type Page } from "@playwright/test";
import { crate, openApp, openTab, panel, pollCrate, setUnits, shot } from "./helpers";

/**
 * Structural sizing (#7, spec §7.15): a heavy batch gets skids, floor joists and a base rating
 * computed from its spans. 30 brackets is 645 kg of payload, one crate under the 1,000 kg limit,
 * over the 450 kg joist threshold: 3 × 4x6 skids and 7 2x4 floor joists.
 */

const modeButton = (page: Page) => page.getByRole("button", { name: /view\. Click for/ });
const viewButton = (page: Page) => page.getByRole("button", { name: "View", exact: true });

async function setQuantity(page: Page, quantity: number) {
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill(String(quantity));
  await pollCrate(page, (s) => s.quantity).toBe(quantity);
}

/** The cut-list row for a piece. */
const row = (page: Page, piece: string): Locator =>
  panel(page).locator("table.cut tbody tr", { has: page.getByRole("cell", { name: piece, exact: true }) }).first();

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("the default batch keeps the nominal base and shows its rating", async ({ page }) => {
  await openTab(page, "Cut list");
  await expect(row(page, "Skid")).toContainText("4x4");
  await expect(panel(page).getByRole("cell", { name: "Floor joist", exact: true })).toHaveCount(0);
  await openTab(page, "Checks");
  await expect(panel(page)).toContainText("Within the base rating");
  await expect(panel(page)).toContainText(/Base rated \d[\d,]* lb; this crate's payload is 190 lb \(\d+%\)\./);
  await setUnits(page, "metric");
  await expect(panel(page)).toContainText(/Base rated \d[\d,]* kg; this crate's payload is 86 kg \(\d+%\)\./);
});

test("a heavy batch gets 4x6 skids and floor joists, in the cut list, checks, 3D and build sheet", async ({ page }) => {
  await setQuantity(page, 30);
  const s = await crate(page);
  expect(s.crateTypes).toEqual([{ label: "A", count: 1, quantity: 30 }]);

  await openTab(page, "Cut list");
  await expect(row(page, "Floor joist")).toContainText("2x4");
  await expect(row(page, "Floor joist").locator("td").last()).toHaveText("7");
  await expect(row(page, "Skid")).toContainText("4x6");
  await expect(row(page, "Skid").locator("td").last()).toHaveText("3");
  // Pin the joists, so the 3D view lights them up.
  await row(page, "Floor joist").click();
  await expect(row(page, "Floor joist")).toHaveAttribute("aria-pressed", "true");
  await shot(page, "24-structure-cutlist");

  await openTab(page, "Checks");
  const rating = panel(page).locator(".check", { hasText: "Within the base rating" });
  await expect(rating).toContainText("Base rated 1,894 lb; this crate's payload is 1,422 lb (75%).");
  await expect(rating).toContainText("3 × 4×6 skids, 7 2×4 floor joists and a 3/4″ floor, sized for 1.5× the load (skid bending governs).");
  await setUnits(page, "metric");
  await expect(rating).toContainText("Base rated 859 kg; this crate's payload is 645 kg (75%).");
  await expect(rating).toContainText("3 × 4×6 skids, 7 2×4 floor joists and a 19 mm floor, sized for 1.5× the load (skid bending governs).");
  await shot(page, "24-structure-checks");
  await setUnits(page, "imperial");

  await openTab(page, "Overview");
  await expect(panel(page)).toContainText(/7 2x4 joists and a/);
  await expect(panel(page)).toContainText(/Rated \d[\d,.]* lb of parts/);

  // Exploded, from the end: the joists lie across the skids under the floor.
  await modeButton(page).click();
  await modeButton(page).click();
  await pollCrate(page, (x) => x.mode).toBe("exploded");
  await pollCrate(page, (x) => x.anim.explode).toBe(1);
  await shot(page, "24-structure-exploded");
  await viewButton(page).click();
  await page.getByRole("button", { name: "End", exact: true }).click();
  await pollCrate(page, (x) => x.view.camera).toBe("end");
  await viewButton(page).click();
  await expect(viewButton(page)).toHaveAttribute("aria-expanded", "false");
  await shot(page, "24-structure-end");
});

test("the build sheet lays the joists across the skids and states the rating", async ({ page, context }) => {
  await context.addInitScript(() => {
    window.print = () => {};
  });
  await setQuantity(page, 30);
  await openTab(page, "Cut list");
  const [popup] = await Promise.all([page.waitForEvent("popup"), panel(page).getByRole("button", { name: "Print / save PDF" }).click()]);
  const build = popup.getByRole("region", { name: "Cut list and assembly", exact: true });
  await expect(build).toBeVisible();
  await expect(build).toContainText("Floor joist");
  await expect(build).toContainText("Floor joists to skids");
  await expect(build).toContainText("Floor to joists");
  await expect(build).toContainText(/screw 7 2x4 floor joists on edge across them/);
  await expect(build).toContainText(/The base is rated for [\d,.]+ lb of parts\./);
  await expect(popup.getByRole("region", { name: "Crate spec" })).toContainText("Within the base rating");
  await build.screenshot({ path: "e2e/screenshots/24-structure-build-sheet.png" });
});

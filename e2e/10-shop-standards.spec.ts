import { expect, test, type Page } from "@playwright/test";
import { openApp, openTab, panel, setUnits, shot } from "./helpers";

/** The Overview cost line, e.g. "about $86 of wood". */
const COST_LINE = /about \$\d+ of wood/;

const woodCost = async (page: Page) => {
  const text = await panel(page).getByText(COST_LINE).textContent();
  return Number(/about \$(\d+) of wood/.exec(text ?? "")![1]);
};

/** Scrolls the Overview so the "of wood" line is in the middle of the panel. */
const showCost = (page: Page) => panel(page).getByText(COST_LINE).evaluate((el) => el.scrollIntoView({ block: "center" }));

const standards = (page: Page) => panel(page).locator("details", { hasText: "Shop standards" });

async function openStandards(page: Page) {
  await openTab(page, "Rules");
  await standards(page).getByText("Shop standards", { exact: true }).click();
  await expect(standards(page)).toHaveAttribute("open", "");
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
});

test("Shop standards is collapsed by default and lists every group", async ({ page }) => {
  await openTab(page, "Rules");
  await expect(standards(page)).not.toHaveAttribute("open", "");
  await expect(standards(page)).toContainText("house rules for every crate");
  await openStandards(page);
  for (const group of ["Stock on hand", "Defaults", "Construction", "Limits", "Rates"]) {
    await expect(standards(page).getByRole("region", { name: group })).toBeVisible();
  }
  await expect(standards(page).getByLabel("Plywood cost")).toHaveValue("1100");
  await expect(standards(page).getByText("Customised")).toHaveCount(0);
  await standards(page).getByRole("heading", { name: "Stock on hand" }).scrollIntoViewIfNeeded();
  await shot(page, "10-standards-open");
});

test("a plywood rate change shows in the Overview cost, survives a reload and resets", async ({ page }) => {
  test.slow(); // two reloads, each waiting for the scene and the model
  await openTab(page, "Overview");
  const before = await woodCost(page);
  await showCost(page);
  await shot(page, "10-standards-cost-before");

  await openStandards(page);
  const rate = standards(page).getByLabel("Plywood cost");
  await rate.fill("2200");
  await expect(standards(page).getByText("Customised")).toBeVisible();
  await expect(standards(page)).toContainText("Default 1100 $/m³.");
  await rate.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shot(page, "10-standards-rate-changed");

  await openTab(page, "Overview");
  await expect.poll(() => woodCost(page)).toBeGreaterThan(before);
  const after = await woodCost(page);
  await showCost(page);
  await shot(page, "10-standards-cost-after");

  // Saved in this browser: a reload keeps the house rules.
  await page.reload();
  await openApp(page);
  await openTab(page, "Overview");
  await expect.poll(() => woodCost(page)).toBe(after);
  await openStandards(page);
  await expect(standards(page).getByLabel("Plywood cost")).toHaveValue("2200");

  await standards(page).getByRole("button", { name: "Reset to defaults" }).click();
  await expect(standards(page).getByText("Customised")).toHaveCount(0);
  await expect(standards(page).getByLabel("Plywood cost")).toHaveValue("1100");
  await openTab(page, "Overview");
  await expect.poll(() => woodCost(page)).toBe(before);

  await page.reload();
  await openApp(page);
  await openTab(page, "Overview");
  await expect.poll(() => woodCost(page)).toBe(before);
});

test("a lower light-panel threshold switches the plywood; bad input is flagged and changes nothing", async ({ page }) => {
  await openTab(page, "Overview");
  await expect(panel(page)).toContainText("12 mm ply");

  await openStandards(page);
  const threshold = standards(page).getByLabel("Light panels up to");
  await threshold.fill("50");
  await openTab(page, "Overview");
  await expect(panel(page)).toContainText("15 mm ply");

  await openStandards(page);
  const density = standards(page).getByLabel("Plywood density");
  await density.fill("-5");
  await expect(density).toHaveAttribute("aria-invalid", "true");
  await density.blur();
  await expect(density).toHaveValue("600");
  await expect(density).not.toHaveAttribute("aria-invalid", "true");
});

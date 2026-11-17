import { expect, test, type Page } from "@playwright/test";
import { openApp, openStandards, openTab, panel, reloadApp, setQuantity, setUnits, shot, standards } from "./helpers";

/** The Overview cost line, e.g. "about $86 of wood". */
const COST_LINE = /about \$(\d+) of wood/;

const woodCost = async (page: Page) => Number(COST_LINE.exec((await panel(page).getByText(COST_LINE).textContent()) ?? "")![1]);

/** Scrolls the Overview so the "of wood" line is in the middle of the panel. */
const showCost = (page: Page) =>
  panel(page)
    .getByText(COST_LINE)
    .evaluate((el) => el.scrollIntoView({ block: "center" }));

/** The plywood thickness the Overview names ("12 mm ply"). */
const plyMm = async (page: Page) => Number(/(\d+) mm ply/.exec((await panel(page).textContent()) ?? "")![1]);

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
});

test("Shop standards is collapsed by default, lists every group, and renders its inputs only while open", async ({ page }) => {
  await openTab(page, "Rules");
  await expect(standards(page)).not.toHaveAttribute("open", "");
  await expect(standards(page)).toContainText("house rules for every crate");
  // Collapsed, the inputs aren't in the page at all.
  await expect(standards(page).getByLabel("Cleat thickness")).toHaveCount(0);
  await openStandards(page);
  for (const group of ["Stock on hand", "Defaults", "Construction", "Limits", "Structure", "Rates", "Cradles"]) {
    await expect(standards(page).getByRole("region", { name: group })).toBeVisible();
  }
  await expect(standards(page).getByRole("region", { name: "Cradles" })).toContainText("Cradle spacing");
  await expect(standards(page).getByLabel("Plywood cost")).toHaveValue(/^\d+$/);
  await expect(standards(page).getByText("Customised")).toHaveCount(0);
  await standards(page).getByRole("heading", { name: "Stock on hand" }).scrollIntoViewIfNeeded();
  await shot(page, "shop-standards-open");
});

test("a plywood rate change shows in the Overview cost, survives a reload and resets", async ({ page }) => {
  test.slow(); // two reloads, each waiting for the scene and the model
  await openTab(page, "Overview");
  const before = await woodCost(page);
  await showCost(page);
  await shot(page, "shop-standards-cost-before");

  await openStandards(page);
  const rate = standards(page).getByLabel("Plywood cost");
  const defaultRate = await rate.inputValue();
  await rate.fill(String(Number(defaultRate) * 2));
  await expect(standards(page).getByText("Customised")).toBeVisible();
  await expect(standards(page)).toContainText(/Default [\d,]+ \$\/m³\./);
  await rate.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shot(page, "shop-standards-rate-changed");

  await openTab(page, "Overview");
  await expect.poll(() => woodCost(page)).toBeGreaterThan(before);
  const after = await woodCost(page);
  await showCost(page);
  await shot(page, "shop-standards-cost-after");

  // Saved in this browser: a reload keeps the house rules.
  await reloadApp(page);
  await openTab(page, "Overview");
  await expect.poll(() => woodCost(page)).toBe(after);
  await openStandards(page);
  await expect(standards(page).getByLabel("Plywood cost")).toHaveValue(String(Number(defaultRate) * 2));

  await standards(page).getByRole("button", { name: "Reset to defaults" }).click();
  await expect(standards(page).getByText("Customised")).toHaveCount(0);
  await expect(standards(page).getByLabel("Plywood cost")).toHaveValue(defaultRate);
  await openTab(page, "Overview");
  await expect.poll(() => woodCost(page)).toBe(before);

  // The reset is saved too.
  await reloadApp(page);
  await openTab(page, "Overview");
  await expect.poll(() => woodCost(page)).toBe(before);
});

test("a lower light-panel threshold switches the plywood; bad input is flagged and changes nothing", async ({ page }) => {
  // Four brackets (the app opens at the recommendation, a heavier load that is medium already).
  await setQuantity(page, 4);
  await openTab(page, "Overview");
  const lightPly = await plyMm(page);

  await openStandards(page);
  await standards(page).getByLabel("Light panels up to").fill("50");
  await openTab(page, "Overview");
  // A 4-part bracket crate now counts as a medium load: thicker panels.
  await expect.poll(() => plyMm(page)).toBeGreaterThan(lightPly);

  await openStandards(page);
  const density = standards(page).getByLabel("Plywood density");
  const before = await density.inputValue();
  await density.fill("-5");
  await expect(density).toHaveAttribute("aria-invalid", "true");
  // A bad value is announced, and says which field and why.
  await expect(standards(page).getByRole("alert")).toBeVisible();
  await density.blur();
  await expect(density).toHaveValue(before);
  await expect(density).not.toHaveAttribute("aria-invalid", "true");

  // The message names the problem, not the stock a rule was checked against.
  await standards(page).getByLabel("Cleat thickness").fill("0");
  await expect(standards(page).getByRole("alert")).toBeVisible();
  await expect(standards(page).getByRole("alert")).not.toContainText(/stock\./);
});

test("in imperial the editor shows and accepts inches and lb, stores metric, and 0 reads as no limit", async ({ page }) => {
  test.slow();
  await setUnits(page, "imperial");
  await openStandards(page);
  const box = standards(page);
  // Stock reads by its names; plywood as sold.
  await expect(box.getByLabel("Cleat thickness")).toHaveValue("0.75");
  await expect(box.getByLabel("Cleat width")).toHaveValue("3.5");
  await expect(box.getByLabel("Floor plywood")).toHaveValue("0.75");
  await expect(box).toContainText("The section is 1x4.");
  await expect(box.getByLabel("Light panels up to")).toHaveValue("330.69");
  // The empty box says what it means, and the stored value is still 0.
  const maxParts = box.getByLabel("Max parts per crate");
  await expect(maxParts).toHaveValue("");
  await expect(maxParts).toHaveAttribute("placeholder", "no limit");
  // A weight typed in lb is kept, and reads back the same after a reload.
  await box.getByLabel("Max gross per crate").fill("1500");
  await expect(box.getByText("Customised")).toBeVisible();
  await expect(box).toContainText(/Default [\d,.]+ lb\./);
  await reloadApp(page);
  await openStandards(page);
  await expect(standards(page).getByLabel("Max gross per crate")).toHaveValue("1500");
  await setUnits(page, "metric");
  await expect(standards(page).getByLabel("Max gross per crate")).toHaveValue(/^680\.38/);
});

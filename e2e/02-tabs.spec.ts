import { expect, test } from "@playwright/test";
import { openApp, openTab, panel, setUnits, shot, tab } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
});

test("Overview shows the build chain and weight by assembly", async ({ page }) => {
  const chain = panel(page).getByRole("listitem");
  await expect(chain).toHaveCount(6);
  for (const [i, step] of ["Parts", "Layout", "Walls and lid", "Base", "Blocking", "Gross weight"].entries()) {
    await expect(chain.nth(i)).toContainText(step);
  }
  await expect(panel(page).getByRole("heading", { name: "Crate weight by assembly" })).toBeVisible();
  await shot(page, "02-overview");
});

test("Layouts shows cards with the recommended one", async ({ page }) => {
  await openTab(page, "Layouts");
  await expect(panel(page).getByRole("heading", { name: "Ways to pack it" })).toBeVisible();
  // Layout cards only: the Rank by toggle (#17) has pressed buttons too.
  const picked = panel(page).locator(`button.opt[aria-pressed="true"]`);
  await expect(picked).toHaveCount(1);
  await expect(picked).toContainText("recommended");
  await expect(picked).toContainText("932 × 652 × 497");
  await expect(panel(page).locator(`button.opt[aria-pressed="false"]`).first()).toBeVisible();
  await shot(page, "02-layouts");
});

test("Cut list groups boards by assembly", async ({ page }) => {
  await openTab(page, "Cut list");
  for (const group of ["Base", "Side walls", "End walls", "Lid", "Inside the crate"]) {
    await expect(panel(page).getByRole("cell", { name: group, exact: true })).toBeVisible();
  }
  await expect(panel(page).getByRole("button", { name: "Download cut list" })).toBeVisible();
  await shot(page, "02-cutlist");
});

test("Rules shows the packing controls", async ({ page }) => {
  await openTab(page, "Rules");
  await expect(panel(page).getByLabel("Quantity")).toHaveValue("4");
  await expect(panel(page).getByLabel("Keep parts upright")).toBeVisible();
  await expect(panel(page).getByRole("group", { name: "Most layers allowed" })).toBeVisible();
  await expect(panel(page).getByLabel("Gap between parts")).toBeVisible();
  await expect(panel(page).getByLabel("Clearance to walls")).toBeVisible();
  await expect(panel(page).getByRole("group", { name: "Wall and lid plywood" })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Reset rules" })).toBeVisible();
  await shot(page, "02-rules");
});

test("Checks lists every rule of thumb", async ({ page }) => {
  // PART-001 × 4 has no cautions, so the tab carries no count badge.
  await expect(tab(page, "Checks")).toHaveText("Checks");
  await openTab(page, "Checks");
  await expect(panel(page).getByRole("heading", { name: "Checks" })).toBeVisible();
  await expect(panel(page)).toContainText("Fits a 53' dry van");
  await expect(panel(page)).toContainText("3D model matches the catalog size");
  await shot(page, "02-checks");
});

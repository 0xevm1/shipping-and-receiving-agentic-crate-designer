import { expect, test, type Page } from "@playwright/test";
import { checks, openApp, openTab, panel, setQuantity, setUnits, shot, tab } from "./helpers";

/**
 * The Checks tab and what points at it: the verdict on the Overview and the tab's counts. The wording
 * and levels of each check are the domain's (its unit tests pin them); these specs prove they reach
 * the screen, follow the units toggle, and link up.
 */

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

/** Makes one part-gap caution: with no gap the parts of the bracket × 4 crate are not restrained. */
async function causeCaution(page: Page) {
  await setQuantity(page, 4);
  await panel(page).getByLabel("Gap between parts", { exact: true }).fill("0");
}

test("Checks lists every rule of thumb, and the default crate has no cautions", async ({ page }) => {
  // The default crate has no cautions, so the tab carries no count badge.
  await expect(tab(page, "Checks")).toHaveText("Checks");
  await openTab(page, "Checks");
  await expect(panel(page).getByRole("heading", { name: "Checks" })).toBeVisible();
  expect(await checks(page).count()).toBeGreaterThan(5);
  await expect(checks(page, "caution")).toHaveCount(0);
  await shot(page, "checks-list");
});

test("imperial check messages carry no mm or kg, metric keeps them", async ({ page }) => {
  await setUnits(page, "imperial");
  await openTab(page, "Checks");
  await expect(checks(page).filter({ hasText: "dry van" })).toContainText(/\d+\.\d in × \d+\.\d in door/);
  const imperial = await checks(page).allInnerTexts();
  expect(imperial.length).toBeGreaterThan(5);
  for (const text of imperial) expect(text).not.toMatch(/\bmm\b|\bkg\b/);
  await expect(panel(page)).toContainText(/Base rated [\d,]+ lb/);
  await shot(page, "checks-imperial");

  await setUnits(page, "metric");
  await expect(checks(page).filter({ hasText: "dry van" })).toContainText(/[\d,]+ mm × [\d,]+ mm door/);
  await expect(panel(page)).toContainText(/Base rated [\d,]+ kg/);
  await shot(page, "checks-metric");
});

test("the Overview verdict says all clear, then names a caution and links to Checks", async ({ page }) => {
  await expect(panel(page).getByTestId("verdict")).toHaveText("All checks clear");
  await shot(page, "checks-verdict-clear");

  await causeCaution(page);
  await openTab(page, "Overview");
  const verdict = panel(page).getByTestId("verdict");
  await expect(verdict).toBeVisible();
  await expect(verdict).toHaveRole("button");
  await expect(verdict).toContainText("1 caution");
  await shot(page, "checks-verdict-caution");
  const verdictText = (await verdict.textContent())!;
  await verdict.click();
  await expect(tab(page, "Checks")).toHaveAttribute("aria-selected", "true");
  // The verdict names the very check that the tab shows as a caution.
  await expect(checks(page, "caution")).toHaveCount(1);
  const title = (await checks(page, "caution").locator("b").textContent())!;
  expect(verdictText.toLowerCase()).toContain(title.toLowerCase());
});

test("the Checks tab counts cautions and notes apart, both readable by a screen reader", async ({ page }) => {
  await causeCaution(page);
  await openTab(page, "Checks");
  const badge = tab(page, "Checks").getByTestId("caution-count");
  await expect(badge).toContainText("caution");
  await expect(badge).toContainText(String(await checks(page, "caution").count()));
  const notes = await checks(page, "info").count();
  const noteBadge = tab(page, "Checks").getByTestId("note-count");
  if (notes) await expect(noteBadge).toContainText(`${notes} note`);
  else await expect(noteBadge).toHaveCount(0);
});

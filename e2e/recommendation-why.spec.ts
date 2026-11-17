import { expect, test } from "@playwright/test";
import { crate, openApp, openTab, panel, shot } from "./helpers";

/**
 * "Why this crate?" (spec §7.16 "Explaining the recommendation"): opened from the best-quantity hint on
 * the Rules tab, it explains the recommendation the app opened at. The sentences and numbers are the
 * domain's (`explainRecommendation.test.ts` pins them); this proves they reach the screen.
 */

test("Why this crate? explains the recommendation: compared, scored, picked, stopped, assumed", async ({ page }) => {
  await openApp(page);
  const { quantity } = await crate(page);
  await openTab(page, "Rules");
  const hint = panel(page).getByTestId("best-quantity");
  const toggle = hint.getByRole("button", { name: "Why this crate?" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  const why = panel(page).getByRole("region", { name: "Why this crate?" });
  await expect(why).toBeVisible();
  for (const title of ["What was compared", "How it is scored", `Why ${quantity} per crate`, "What stopped a larger crate", "What it takes into account"]) {
    await expect(why.getByRole("heading", { name: title })).toBeVisible();
  }
  // The pick is among the part's suggested quantities, not every quantity from 1 to 200.
  await expect(why).toContainText("suggested quantities");
  // The app has no freight rates: freight is never priced in dollars.
  const cost = why.getByRole("table", { name: `Cost of ${quantity} per crate` });
  await expect(cost.getByRole("row", { name: /Freight/ })).toContainText("Not priced");
  await expect(cost.getByRole("row", { name: /Per part/ })).toContainText(/\$\d+\.\d\d/);
  const best = why.getByRole("table", { name: "Best quantities by cost per part" });
  await expect(best.getByRole("row").nth(1)).toContainText(String(quantity));
  await expect(best.getByRole("row").nth(1)).toContainText("recommended");
  await expect(why.getByRole("img", { name: /Cost per part by quantity per crate/ })).toBeVisible();
  await expect(why).toContainText("One part number per crate");
  await why.scrollIntoViewIfNeeded();
  await shot(page, "recommendation-why");

  await toggle.click();
  await expect(why).toHaveCount(0);
});

import { expect, test } from "@playwright/test";
import { island, openApp, openTab, panel, shot } from "./helpers";

// Narrow project (900 × 900): below 980 px the layout stacks (spec §8.2).
test("at 900 px the layout stacks with no horizontal scroll", async ({ page }) => {
  await openApp(page);

  // Header, canvas, view bar, then the island, top to bottom.
  const stage = page.getByRole("region", { name: "3D view of the crate" });
  const top = async (l: ReturnType<typeof page.locator>) => (await l.boundingBox())!.y;
  const headerY = await top(page.getByRole("banner"));
  const stageY = await top(stage);
  const unitsY = await top(page.getByRole("group", { name: "Units" }));
  const islandY = await top(island(page));
  expect(headerY).toBeLessThan(stageY);
  expect(stageY).toBeLessThan(unitsY);
  expect(unitsY).toBeLessThan(islandY);
  await expect(page.getByRole("button", { name: "Hide panels" })).toBeHidden();

  // The canvas still renders in its stacked slot.
  expect(await page.evaluate(() => window.__crate!.canvasCoverage())).toBeGreaterThan(0.05);

  for (const name of ["Overview", "Layouts", "Cut list", "Rules", "Checks"]) {
    await openTab(page, name);
    await expect(panel(page)).toBeVisible();
    const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${name}`).toBeLessThanOrEqual(0);
  }
  await openTab(page, "Overview");
  await shot(page, "08-narrow-stacked");
});

import { expect, test, type Page } from "@playwright/test";
import { crate, openApp, openTab, panel, pollCrate, shot, tab } from "./helpers";

/**
 * Centre of gravity, forklift and pallet-jack handling (#8): the checks, the 3D marks (a
 * quartered CoG ball with a drop line, fork-entry arrows at both ends) that go with the size
 * labels, and the CoG mark on the shipping label.
 */

const viewButton = (page: Page) => page.getByRole("button", { name: "View", exact: true });

async function openViewPopover(page: Page) {
  await viewButton(page).click();
  const id = await viewButton(page).getAttribute("aria-controls");
  const pop = page.locator(`[id="${id}"]`);
  await expect(pop).toBeVisible();
  return pop;
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("Checks lists the centre of gravity and the forklift and pallet-jack checks", async ({ page }) => {
  // The pallet jack is info (forklift only) on the default crate, so there is still no badge.
  await expect(tab(page, "Checks")).toHaveText("Checks");
  await openTab(page, "Checks");
  const p = panel(page);
  await expect(p).toContainText("Centre of gravity near the middle");
  await expect(p).toContainText("It is on both centre lines");
  await expect(p).toContainText("Low centre of gravity");
  await expect(p).toContainText("Forklift fits from the ends");
  await expect(p).toContainText("Forklift: fits from the ends, 89 mm clear under the floor, needs 75 mm.");
  await expect(p).toContainText("Forklift only: too narrow for a pallet jack");
  await p.getByText("Forklift only: too narrow for a pallet jack").scrollIntoViewIfNeeded();
  await shot(page, "25-handling-checks");
});

test("the 3D view marks the centre of gravity and the fork entry, with the size labels", async ({ page }) => {
  const s = await crate(page);
  expect(s.cog).not.toBeNull();
  const [L, W] = [932 - 2 * (12 + 19), 652 - 2 * (12 + 19)];
  // Symmetric 2 × 2 load: on both centre lines of the interior.
  expect(s.cog!.mm[0]).toBeCloseTo(L / 2, 3);
  expect(s.cog!.mm[1]).toBeCloseTo(W / 2, 3);
  await pollCrate(page, (c) => c.cog?.marker).toEqual(s.cog!.mm);
  // One opening between the two skids, an arrow at each end.
  await pollCrate(page, (c) => c.cog?.arrows).toBe(2);

  // Parts off, so their size labels don't sit over the CoG mark in the screenshots.
  const parts = await openViewPopover(page);
  await parts.getByLabel("Parts", { exact: true }).uncheck();
  await viewButton(page).click();
  await expect(parts).toBeHidden();

  // Exploded: the marks stay and the arrows slide out with the end walls.
  await page.getByRole("button", { name: /view\. Click for/ }).click();
  await page.getByRole("button", { name: /view\. Click for/ }).click();
  await pollCrate(page, (c) => c.anim.explode).toBe(1);
  await pollCrate(page, (c) => c.cog?.arrows).toBe(2);
  await shot(page, "25-handling-3d-exploded");
  await page.getByRole("button", { name: /view\. Click for/ }).click();
  await pollCrate(page, (c) => c.mode).toBe("closed");
  await shot(page, "25-handling-3d");

  const pop = await openViewPopover(page);
  await pop.getByLabel("Size labels", { exact: true }).uncheck();
  await pollCrate(page, (c) => c.cog?.marker).toBeNull();
  await pollCrate(page, (c) => c.cog?.arrows).toBe(0);
  // The design still has its CoG; only the marks are hidden.
  expect((await crate(page)).cog!.mm).toEqual(s.cog!.mm);
  await pop.getByLabel("Size labels", { exact: true }).check();
  await pollCrate(page, (c) => c.cog?.marker).toEqual(s.cog!.mm);
});

test("the shipping label marks the centre of gravity between the fork arrows", async ({ page }) => {
  await page.context().addInitScript(() => {
    window.print = () => {};
  });
  await openTab(page, "Cut list");
  const [popup] = await Promise.all([page.waitForEvent("popup"), panel(page).getByRole("button", { name: "Print / save PDF" }).click()]);
  const label = popup.getByRole("region", { name: "Shipping label", exact: true });
  await expect(label).toContainText("FORK ENTRY FROM THE ENDS");
  await expect(label).toContainText("FORKS");
  const mark = label.locator('[aria-label="Centre of gravity"]');
  await expect(mark).toBeVisible();
  await expect(mark).toContainText("CENTRE OF GRAVITY");
  // The mark sits mid-width on the end view: its circle is centred on the crate end.
  const end = label.getByRole("img", { name: "Crate end with fork entry marks" });
  const [endBox, circle] = await Promise.all([end.locator("rect").first().boundingBox(), mark.locator("circle").boundingBox()]);
  expect(Math.abs(circle!.x + circle!.width / 2 - (endBox!.x + endBox!.width / 2))).toBeLessThan(2);
  await label.screenshot({ path: "e2e/screenshots/25-handling-label.png" });
});

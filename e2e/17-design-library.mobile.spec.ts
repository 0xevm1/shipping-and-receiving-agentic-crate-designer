import { expect, test, type Page } from "@playwright/test";
import { openApp, panel, pollCrate, shot, tab } from "./helpers";

// The design library (#14) inside the phone drawer (#42): save, list and reuse with touch.

const burger = (page: Page) => page.getByRole("button", { name: "Crate details" });
const drawer = (page: Page) => page.getByRole("dialog", { name: "Crate details" });
const section = (page: Page) => panel(page).getByRole("region", { name: "Saved designs" });

test("saving and reusing a design works inside the drawer", async ({ page }) => {
  await openApp(page);
  await burger(page).tap();
  await expect(drawer(page)).toBeVisible();
  await tab(page, "Rules").tap();
  await panel(page).getByLabel("Quantity").fill("8");
  await pollCrate(page, (s) => s.quantity).toBe(8);
  await tab(page, "Overview").tap();

  const save = section(page).getByRole("button", { name: "Save design" });
  await save.scrollIntoViewIfNeeded();
  expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await save.tap();
  await section(page).getByLabel("Design name").fill("Phone save");
  await section(page).getByRole("button", { name: "Save", exact: true }).tap();
  await expect(section(page).getByRole("listitem")).toContainText("Phone save");

  await tab(page, "Rules").tap();
  await panel(page).getByLabel("Quantity").fill("2");
  await pollCrate(page, (s) => s.quantity).toBe(2);
  await tab(page, "Overview").tap();
  const use = section(page).getByRole("button", { name: "Use Phone save" });
  await use.scrollIntoViewIfNeeded();
  expect((await use.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await shot(page, `14-${test.info().project.name}-drawer-saved-designs`);
  await use.tap();
  await pollCrate(page, (s) => s.quantity).toBe(8);
  // The page itself never scrolls; only the panel does.
  expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
});

import { expect, test } from "@playwright/test";
import { openApp, openDrawer, openTab, panel, pollCrate, shot } from "./helpers";

// The design library inside the phone drawer: save, list and reuse with touch.

const section = (page: Parameters<typeof panel>[0]) => panel(page).getByRole("region", { name: "Saved designs" });

test("saving and reusing a design works inside the drawer", async ({ page }) => {
  await openApp(page);
  await openDrawer(page);
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill("8");
  await pollCrate(page, (s) => s.quantity).toBe(8);
  await openTab(page, "Overview");

  const save = section(page).getByRole("button", { name: "Save design" });
  await save.scrollIntoViewIfNeeded();
  expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await save.tap();
  await section(page).getByLabel("Design name").fill("Phone save");
  await section(page).getByRole("button", { name: "Save", exact: true }).tap();
  await expect(section(page).getByRole("listitem")).toContainText("Phone save");

  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill("2");
  await pollCrate(page, (s) => s.quantity).toBe(2);
  await openTab(page, "Overview");
  const use = section(page).getByRole("button", { name: "Use Phone save" });
  await use.scrollIntoViewIfNeeded();
  expect((await use.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await shot(page, "design-library-drawer");
  await use.tap();
  await pollCrate(page, (s) => s.quantity).toBe(8);
  // The page itself never scrolls; only the panel does.
  expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
});

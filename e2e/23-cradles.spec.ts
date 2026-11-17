import { expect, test, type Page } from "@playwright/test";
import { crate, fileInput, openApp, openTab, panel, pollCrate, sampleFile, shot } from "./helpers";

/**
 * Cradles for long parts (#6): the shaft (PART-002) sits in notched cradles with end stops,
 * which show in the cut list, light up in 3D from it, and are drawn on the build sheet.
 */

const SHAFT = "PART-002-long-steel-shaft.glb";

async function openShaft(page: Page, quantity: number) {
  await openApp(page);
  await fileInput(page).setInputFiles(sampleFile(SHAFT));
  await pollCrate(page, (s) => s.partId).toBe("PART-002");
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill(String(quantity));
  await pollCrate(page, (s) => s.quantity).toBe(quantity);
}

const row = (page: Page, piece: string) =>
  panel(page).locator("table.cut tbody tr", { has: page.getByRole("cell", { name: piece, exact: true }) }).first();

test("the shaft's cut list has cradle rows, and pinning one lights the cradles in 3D", async ({ page }) => {
  await openShaft(page, 4);
  // Open view: lid off and the front wall faded, so the cradles are in sight.
  await page.getByRole("button", { name: "Closed view. Click for open." }).click();
  await pollCrate(page, (s) => s.mode).toBe("open");

  await openTab(page, "Cut list");
  for (const piece of ["Cradle", "Stacking cradle", "End stop"]) await expect(row(page, piece)).toBeVisible();
  await expect(row(page, "Bearer")).toHaveCount(0);
  await expect(row(page, "Layer separator")).toHaveCount(0);
  await expect(row(page, "Blocking post")).toHaveCount(0);
  await expect(row(page, "Cradle").locator("td").last()).toHaveText("4");

  const cradle = row(page, "Cradle");
  await cradle.hover();
  await pollCrate(page, (s) => s.hoverKey).toMatch(/^inside\|Cradle\|/);
  await cradle.click();
  await expect(cradle.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  const { pin } = await crate(page);
  expect(pin).toMatch(/^inside\|Cradle\|.*\|2 notches$/); // two shafts side by side in each layer
  await expect(page.getByText("Showing 4 × cradle")).toBeVisible();
  await shot(page, "23-cradles-pinned");

  await page.keyboard.press("Escape");
  await pollCrate(page, (s) => s.pin).toBeNull();
  await shot(page, "23-cradles-cutlist");
});

test("the Overview and Checks describe the cradles", async ({ page }) => {
  await openShaft(page, 1);
  await openTab(page, "Overview");
  await expect(panel(page)).toContainText("4 cradles");
  await openTab(page, "Checks");
  await expect(panel(page)).toContainText("4 notched cradles hold the parts across their length, and 2 end stops hold them along it.");
});

test("the shop standards have a Cradles group", async ({ page }) => {
  await openApp(page);
  await openTab(page, "Rules");
  const standards = panel(page).locator("details", { hasText: "Shop standards" });
  await standards.locator("summary").click();
  const group = standards.getByRole("region", { name: "Cradles" });
  await expect(group).toBeVisible();
  await expect(group).toContainText("Cradle spacing");
});

test("the build sheet draws the cradles in both sections and lists them in the assembly", async ({ page, context }) => {
  await context.addInitScript(() => {
    window.print = () => undefined;
  });
  await openShaft(page, 4);
  await openTab(page, "Cut list");
  const [p] = await Promise.all([page.waitForEvent("popup"), panel(page).getByRole("button", { name: "Print / save PDF" }).click()]);
  const drawings = p.getByRole("region", { name: "Build sheet", exact: true });
  await expect(drawings.getByRole("img", { name: /^Section A–A: .*cradles/ })).toBeVisible();
  await expect(drawings.getByRole("img", { name: /^Section B–B: .*cradles/ })).toBeVisible();
  await drawings.screenshot({ path: "e2e/screenshots/23-cradles-build-drawings.png" });
  const build = p.getByRole("region", { name: "Cut list and assembly", exact: true });
  for (const text of ["Cradle", "Stacking cradle", "End stop", "Cradles to floor", "notched cradles"]) await expect(build).toContainText(text);
  await build.screenshot({ path: "e2e/screenshots/23-cradles-build-cutlist.png" });
});

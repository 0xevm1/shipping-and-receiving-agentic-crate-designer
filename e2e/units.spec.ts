import { expect, test } from "@playwright/test";
import { crate, cutTable, header, inText, mmText, openApp, openTab, panel, readDownloadText, reloadApp, setUnits, shot } from "./helpers";

/**
 * Display units: the app opens in inches and pounds with nominal lumber names, metric is one toggle
 * away, and the choice survives a reload. The sizes come from the test hook and only their format is
 * checked here; the conversions themselves are unit-tested.
 */

const unitsGroup = (page: Parameters<typeof setUnits>[0]) => page.getByRole("group", { name: "Units" });
const labels = (page: Parameters<typeof setUnits>[0]) => page.getByTestId("size-labels");

test("first load is imperial: inches and pounds in the header, Overview and size labels", async ({ page }) => {
  await openApp(page);
  const { units, outside } = await crate(page);
  expect(units).toBe("imperial");
  await expect(unitsGroup(page).getByRole("button", { name: "in lb" })).toHaveAttribute("aria-pressed", "true");

  await expect(header(page)).toContainText(/\d+\.\d × \d+\.\d × \d+\.\d in/);
  await expect(header(page)).toContainText(/4140 steel · [\d.]+ lb each · crate gross \d+ lb/);
  await expect(panel(page)).toContainText(inText(outside!));
  // The other-unit line under the size is in millimetres.
  await expect(panel(page)).toContainText(`${mmText(outside!)} mm`);
  await expect(labels(page)).toContainText(`${(outside![0] / 25.4).toFixed(1)} in`);
  await expect(labels(page)).not.toContainText("mm");
  await shot(page, "units-imperial");
});

test("the toggle switches the header, Overview and size labels to mm and kg, and back", async ({ page }) => {
  await openApp(page);
  const { outside } = await crate(page);

  await setUnits(page, "metric");
  await expect(header(page)).toContainText(/[\d.]+ kg each/);
  await expect(panel(page)).toContainText(`${inText(outside!)} in`);
  await expect(labels(page)).toContainText(`${Math.round(outside![0])} mm`);
  await shot(page, "units-metric");

  await setUnits(page, "imperial");
  await expect(header(page)).toContainText("lb each");
  await expect(labels(page)).toContainText(`${(outside![0] / 25.4).toFixed(1)} in`);
});

test("a part's mass reads the same in the header and the Overview", async ({ page }) => {
  await openApp(page);
  for (const [units, unit] of [
    ["imperial", "lb"],
    ["metric", "kg"],
  ] as const) {
    await setUnits(page, units);
    const mass = /([\d.]+) (?:lb|kg) each/.exec((await header(page).textContent()) ?? "")![1];
    await expect(panel(page)).toContainText(`${mass} ${unit}`);
  }
});

test("imperial names lumber and plywood by their sold sizes, in the Overview, the Cut list and the CSV", async ({ page }) => {
  await openApp(page);
  await expect(panel(page)).toContainText(/\d\/\d″ ply/);
  await expect(panel(page)).toContainText(/stiffened with \dx\d cleats/);
  await expect(panel(page)).toContainText(/\dx\d skids under a \d\/\d″ floor/);

  await openTab(page, "Cut list");
  await expect(panel(page).getByRole("columnheader", { name: "Cut, in" })).toBeVisible();
  // Nominal stock, fractional-inch cuts.
  const stock = cutTable(page).getByTestId("cut-stock");
  await expect(stock.filter({ hasText: /^\d\/\d″ plywood$/ }).first()).toBeVisible();
  await expect(stock.filter({ hasText: /^\dx\d$/ }).first()).toBeVisible();
  await expect(stock.filter({ hasText: /from \dx\d$/ }).first()).toHaveText(/^\d+( \d+\/\d+)?″ × \d+( \d+\/\d+)?″ from \dx\d$/);
  await expect(cutTable(page).getByTestId("cut-size").first()).toHaveText(/^\d+( \d+\/\d+)?″ × \d+( \d+\/\d+)?″$/);
  await shot(page, "units-cut-list-nominal");

  // The CSV follows the units: inches and pounds, nominal stock.
  const [download] = await Promise.all([page.waitForEvent("download"), panel(page).getByRole("button", { name: "Download cut list" }).click()]);
  expect(download.suggestedFilename()).toBe("crate-PART-001-x4.csv");
  const csv = await readDownloadText(download);
  expect(csv).toMatch(/# Part 4140 steel, [\d.]+ lb each\n/);
  expect(csv).toContain("# Units: inches (cuts to the nearest 1/16) and pounds; lumber by nominal size\ncomponent,material,stock,cut_in,qty\n");
  expect(csv).toMatch(/\nBase: Skid,lumber,\dx\d,\d+( \d+\/\d+)? in,\d+\n/);
  expect(csv).toMatch(/\nSide walls: Side rail,lumber,\dx\d,/);
});

test("metric is one toggle away and survives a reload; so does a return to imperial", async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
  await expect(panel(page)).toContainText(/\d+ mm ply/);
  await expect(panel(page)).toContainText(/stiffened with \d+ × \d+ cleats/);

  await reloadApp(page);
  expect((await crate(page)).units).toBe("metric");
  await expect(unitsGroup(page).getByRole("button", { name: "mm kg" })).toHaveAttribute("aria-pressed", "true");
  await expect(header(page)).toContainText(/[\d.]+ kg each/);

  await openTab(page, "Cut list");
  await expect(panel(page).getByRole("columnheader", { name: "Cut, mm" })).toBeVisible();
  await expect(cutTable(page)).toContainText(/\d+ × \d+ lumber/);
  const [download] = await Promise.all([page.waitForEvent("download"), panel(page).getByRole("button", { name: "Download cut list" }).click()]);
  expect(await readDownloadText(download)).toContain("# Units: mm and kg\ncomponent,material,stock,cut_mm,qty\n");

  await setUnits(page, "imperial");
  await reloadApp(page);
  expect((await crate(page)).units).toBe("imperial");
});

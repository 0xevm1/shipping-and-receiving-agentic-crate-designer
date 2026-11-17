import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { crate, openApp, openTab, panel, setUnits, shot } from "./helpers";

// A US shop floor (#15): the app opens in inches and pounds with nominal lumber names; metric is
// one toggle away and the choice survives a reload.

test("first load is imperial, with nominal lumber in the Overview, Cut list and CSV", async ({ page }) => {
  await openApp(page);
  expect((await crate(page)).units).toBe("imperial");
  const units = page.getByRole("group", { name: "Units" });
  await expect(units.getByRole("button", { name: "in lb" })).toHaveAttribute("aria-pressed", "true");

  const header = page.getByRole("banner");
  await expect(header).toContainText(/4140 steel · 47.4 lb each · crate gross \d+ lb/);
  await expect(page.getByTestId("size-labels")).toContainText("36.7 in");

  // Overview: inches and pounds, plywood by its sold thickness, lumber by nominal size.
  const p = panel(page);
  await expect(p).toContainText("36.7 × 25.7 × 19.6");
  await expect(p).toContainText(/gross \d+ lb/);
  await expect(p).toContainText("1/2″ ply");
  await expect(p).toContainText("stiffened with 1x4 cleats");
  await expect(p).toContainText("4x4 skids under a 3/4″ floor");
  await shot(page, "15-overview-imperial");

  // Cut list: nominal stock, fractional-inch cuts.
  await openTab(page, "Cut list");
  await expect(p.getByRole("columnheader", { name: "Cut, in" })).toBeVisible();
  const stock = p.locator("table.cut tbody tr:not(.grp) td:nth-child(2)");
  await expect(stock).toContainText(["3/4″ plywood", "4x4", "1/2″ plywood", "1x4"]);
  await expect(stock.filter({ hasText: /from 4x4$/ }).first()).toHaveText("1 15/16″ × 3 1/2″ from 4x4");
  const cuts = p.locator("table.cut tbody tr:not(.grp) td:nth-child(3)");
  await expect(cuts.first()).toHaveText(/^\d+( \d+\/\d+)?″ × \d+( \d+\/\d+)?″$/);
  await shot(page, "15-cutlist-nominal");
  // Blocking is cut to the gap: its size and the stock it comes from.
  await stock.filter({ hasText: /from 4x4$/ }).last().scrollIntoViewIfNeeded();
  await shot(page, "15-cutlist-blocking");

  // The CSV follows the units: inches and pounds, nominal stock.
  const [download] = await Promise.all([page.waitForEvent("download"), p.getByRole("button", { name: "Download cut list" }).click()]);
  expect(download.suggestedFilename()).toBe("crate-PART-001-x4.csv");
  const csv = readFileSync((await download.path())!, "utf8");
  expect(csv).toContain("# Part 4140 steel, 47.4 lb each\n");
  expect(csv).toContain("# Units: inches (cuts to the nearest 1/16) and pounds; lumber by nominal size\ncomponent,material,stock,cut_in,qty\n");
  expect(csv).toMatch(/\nBase: Skid,lumber,4x4,\d+( \d+\/\d+)? in,2\n/);
  expect(csv).toMatch(/\nSide walls: Side rail,lumber,1x4,/);
});

test("metric is one toggle away and survives a reload", async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
  await expect(page.getByRole("banner")).toContainText("21.5 kg each");
  await expect(panel(page)).toContainText("12 mm ply");
  await expect(panel(page)).toContainText("stiffened with 19 × 89 cleats");
  await shot(page, "15-overview-metric");

  await page.reload();
  await openApp(page);
  expect((await crate(page)).units).toBe("metric");
  await expect(page.getByRole("group", { name: "Units" }).getByRole("button", { name: "mm kg" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("banner")).toContainText("21.5 kg each");
  await expect(page.getByTestId("size-labels")).toContainText("932 mm");

  await openTab(page, "Cut list");
  await expect(panel(page).getByRole("columnheader", { name: "Cut, mm" })).toBeVisible();
  await expect(panel(page).locator("table.cut")).toContainText("19 × 89 lumber");
  const [download] = await Promise.all([page.waitForEvent("download"), panel(page).getByRole("button", { name: "Download cut list" }).click()]);
  const csv = readFileSync((await download.path())!, "utf8");
  expect(csv).toContain("# Units: mm and kg\ncomponent,material,stock,cut_mm,qty\n");

  // And back to imperial, which is also remembered.
  await setUnits(page, "imperial");
  await page.reload();
  await openApp(page);
  expect((await crate(page)).units).toBe("imperial");
});

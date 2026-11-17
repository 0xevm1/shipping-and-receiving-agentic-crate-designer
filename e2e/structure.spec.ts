import { expect, test, type Page } from "@playwright/test";
import {
  checks,
  crate,
  cutQty,
  cutRow,
  explode,
  openApp,
  openPrintTab,
  openTab,
  openViewPopover,
  panel,
  pinnedRow,
  pollCrate,
  setQuantity,
  setUnits,
  sheet,
  shot,
  stubPrint,
  viewButton,
} from "./helpers";

/**
 * Structural sizing (spec §7.15): a heavy batch gets 4x6 skids, floor joists and a base rating computed from
 * its spans. 30 brackets is one crate under the 1,000 kg limit and over the 450 kg joist threshold. The
 * formulas, the counts and the rating are unit-tested (`structure.test.ts`); this checks that the cut list, the
 * checks, the 3D view and the build sheet all show the same structure.
 */

test.beforeEach(async ({ page, context }) => {
  await stubPrint(context);
  await openApp(page);
  // The light batch: the app opens at the recommendation, which is already heavy.
  await setQuantity(page, 4);
});

/** The base-rating check: its payload and rated load, as numbers, in the units on screen. */
async function rating(page: Page) {
  const text = (await checks(page).filter({ hasText: "Base rated" }).textContent()) ?? "";
  const m = /Base rated ([\d,]+) \w+; this crate's payload is ([\d,]+) \w+ \((\d+)%\)/.exec(text)!;
  return { rated: Number(m[1].replace(/,/g, "")), payload: Number(m[2].replace(/,/g, "")), pct: Number(m[3]) };
}

test("the default batch keeps the nominal base and shows its rating", async ({ page }) => {
  await openTab(page, "Cut list");
  await expect(cutRow(page, "Skid")).toContainText(/\dx\d/);
  await expect(panel(page).getByRole("cell", { name: "Floor joist", exact: true })).toHaveCount(0);
  await openTab(page, "Checks");
  await expect(panel(page)).toContainText("Within the base rating");
  const lb = await rating(page);
  expect(lb.payload).toBeLessThan(lb.rated);
  expect(lb.pct).toBe(Math.round((lb.payload / lb.rated) * 100));
  await setUnits(page, "metric");
  const kg = await rating(page);
  // The same rating in the other unit: pounds are 2.2 times kilograms.
  expect(kg.rated * 2.20462).toBeCloseTo(lb.rated, -2);
  expect(kg.pct).toBe(lb.pct);
});

test("a heavy batch gets bigger skids and floor joists, in the cut list, checks, 3D and build sheet", async ({ page }) => {
  await openTab(page, "Cut list");
  const defaultSkid = /\dx\d/.exec((await cutRow(page, "Skid").textContent()) ?? "")![0];
  await setQuantity(page, 30);
  expect((await crate(page)).crateTypes).toEqual([{ label: "A", count: 1, quantity: 30 }]);

  await openTab(page, "Cut list");
  await expect(cutRow(page, "Floor joist")).toBeVisible();
  const joists = Number(await cutQty(cutRow(page, "Floor joist")).textContent());
  const skids = Number(await cutQty(cutRow(page, "Skid")).textContent());
  expect(joists).toBeGreaterThan(0);
  // The skids grew from the default batch's section.
  const skid = /\dx\d/.exec((await cutRow(page, "Skid").textContent()) ?? "")![0];
  expect(skid).not.toBe(defaultSkid);
  // Pin the joists, so the 3D view lights them up.
  await cutRow(page, "Floor joist").click();
  await expect(cutRow(page, "Floor joist").getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await expect(pinnedRow(page)).toHaveCount(1);
  await shot(page, "structure-cut-list");

  // The check names what the cut list has: its skids, joists and the load factor.
  await openTab(page, "Checks");
  const check = checks(page).filter({ hasText: "Within the base rating" });
  await expect(check).toContainText(new RegExp(`${skids} × ${skid} skids, ${joists} \\dx\\d floor joists and a .* floor, sized for 1\\.5× the load`));
  expect((await rating(page)).pct).toBeLessThanOrEqual(100);
  await setUnits(page, "metric");
  await expect(check).toContainText(/Base rated [\d,]+ kg; this crate's payload is [\d,]+ kg/);
  await shot(page, "structure-checks");
  await setUnits(page, "imperial");

  await openTab(page, "Overview");
  await expect(panel(page)).toContainText(new RegExp(`${joists} \\dx\\d joists and a`));
  await expect(panel(page)).toContainText(/Rated [\d,.]+ lb of parts/);

  // Exploded, from the end: the joists lie across the skids under the floor.
  await explode(page);
  await shot(page, "structure-exploded");
  const pop = await openViewPopover(page);
  await pop.getByRole("button", { name: "End", exact: true }).click();
  await pollCrate(page, (x) => x.view.camera).toBe("end");
  await viewButton(page).click();
  await expect(viewButton(page)).toHaveAttribute("aria-expanded", "false");
  await shot(page, "structure-end");
});

test("the build sheet lays the joists across the skids and states the rating", async ({ page }) => {
  await setQuantity(page, 30);
  const print = await openPrintTab(page);
  const build = sheet(print, "Cut list and assembly");
  await expect(build).toBeVisible();
  await expect(build).toContainText("Floor joist");
  await expect(build).toContainText("Floor joists to skids");
  await expect(build).toContainText("Floor to joists");
  await expect(build).toContainText(/screw \d+ \dx\d floor joists on edge across them/);
  await expect(build).toContainText(/The base is rated for [\d,.]+ lb of parts\./);
  await expect(sheet(print, "Crate spec")).toContainText("Within the base rating");
  await shot(build, "structure-build-sheet");
});

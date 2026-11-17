import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, openTab, panel, pollCrate, setUnits } from "./helpers";

/**
 * The export bundle (#26): "Print / save PDF" in the Cut list opens the print route in a new
 * tab with the design in the URL hash, and that tab opens the print dialog. The document has a
 * crate spec, a build sheet (drawings, then cut list and assembly) and a shipping label per
 * crate type, in the selected units.
 */

declare global {
  interface Window {
    __printCalls?: number;
  }
}

test.beforeEach(async ({ context }) => {
  // Count print dialogs instead of opening one; applies to the new tab too.
  await context.addInitScript(() => {
    window.__printCalls = 0;
    window.print = () => {
      window.__printCalls = (window.__printCalls ?? 0) + 1;
    };
  });
});

/** Clicks Print / save PDF and returns the print tab once the document is drawn. */
async function openPrint(page: Page, units: "imperial" | "metric") {
  await openTab(page, "Cut list");
  const [popup] = await Promise.all([page.waitForEvent("popup"), panel(page).getByRole("button", { name: "Print / save PDF" }).click()]);
  await expect(panel(page).getByRole("status")).toHaveText("Print view opened in a new tab.");
  expect(popup.url()).toMatch(new RegExp(`/print#design=[A-Za-z0-9_-]+&u=${units}&print=1$`));
  await expect(popup.getByRole("region", { name: "Crate spec" })).toBeVisible();
  await expect.poll(() => popup.evaluate(() => window.__printCalls)).toBe(1);
  return popup;
}

const sheet = (p: Page, name: string) => p.getByRole("region", { name, exact: true });

/** One screenshot per printed page, to `e2e/screenshots/`. */
async function shotSheet(locator: Locator, name: string) {
  await locator.screenshot({ path: `e2e/screenshots/${name}.png` });
}

/** The page as a PDF in Chromium: non-empty, and the number of pages in it. */
async function pdfPages(p: Page, name: string) {
  const pdf = await p.pdf({ format: "Letter", preferCSSPageSize: true });
  writeFileSync(`e2e/screenshots/${name}.pdf`, pdf);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(20_000);
  return (pdf.toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
}

test("Print / save PDF gives the crate spec, build sheet and label for the default design, in imperial", async ({ page }) => {
  await openApp(page);
  const p = await openPrint(page, "imperial");
  await expect(p).toHaveTitle("Crate for 4 × Machined steel bracket · Crate Designer");

  const spec = sheet(p, "Crate spec");
  await expect(spec).toContainText("Crate for 4 × Machined steel bracket");
  await expect(spec).toContainText("PART-001");
  await expect(spec).toContainText("47.4 lb");
  await expect(spec).toContainText("36.7 × 25.7 × 19.6 in");
  await expect(spec).toContainText("932 × 652 × 497 mm");
  await expect(spec).toContainText("Dimensional weight");
  await expect(spec).toContainText(/\d+\.\d lb\/ft³/);
  await expect(spec).toContainText("Freight class");
  await expect(spec).toContainText("The recommended layout");
  await expect(spec).toContainText("Runner-up:");
  await expect(spec).toContainText("Fits a 53' dry van");
  await expect(spec).toContainText("Every part is blocked in");
  await shotSheet(spec, "26-spec");

  const drawings = sheet(p, "Build sheet");
  await expect(drawings).toContainText("Dimensions in inches");
  for (const view of ["Top", "Front", "End", /^Section A–A/, /^Section B–B/]) {
    await expect(drawings.getByRole("img", { name: view, exact: typeof view === "string" })).toBeVisible();
  }
  await expect(drawings.getByRole("img", { name: "Front", exact: true })).toContainText("36 11/16″");
  await shotSheet(drawings, "26-build-drawings");

  const build = sheet(p, "Cut list and assembly");
  for (const stock of ["3/4″ plywood", "1/2″ plywood", "4x4", "1x4"]) await expect(build).toContainText(stock);
  await expect(build).toContainText("Floor to skids");
  await expect(build).toContainText("Wood screws, about");
  await expect(build.locator("ol.steps > li > b")).toHaveText(["Base", "Walls", "Load the parts", "Blocking and separators", "Lid"]);
  await shotSheet(build, "26-build-cutlist");

  const label = sheet(p, "Shipping label");
  await expect(label).toContainText("PART-001");
  await expect(label).toContainText("4 PCS");
  await expect(label).toContainText(/\d+ LB/);
  await expect(label).toContainText("THIS SIDE UP");
  await expect(label).toContainText("FORKS");
  await expect(label).toContainText("FORK ENTRY FROM THE ENDS");
  await shotSheet(label, "26-label");

  // Spec, drawings, cut list and label: at least four Letter pages.
  expect(await pdfPages(p, "26-default")).toBeGreaterThanOrEqual(4);
});

test("the print view follows metric units", async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
  const p = await openPrint(page, "metric");
  const spec = sheet(p, "Crate spec");
  await expect(spec).toContainText("932 × 652 × 497 mm");
  await expect(spec).toContainText("21.5 kg");
  await expect(spec).toContainText(/\d+ kg\/m³/);
  await expect(sheet(p, "Build sheet")).toContainText("Dimensions in mm");
  await expect(sheet(p, "Cut list and assembly")).toContainText("19 × 89 lumber");
  await expect(sheet(p, "Shipping label")).toContainText(/\d+ KG/);
  await shotSheet(spec, "26-spec-metric");
  expect(await pdfPages(p, "26-metric")).toBeGreaterThanOrEqual(4);
});

test("a split shipment prints the plan and a spec, build sheet and label per crate type", async ({ page }) => {
  await openApp(page);
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill("200");
  await pollCrate(page, (s) => s.quantity).toBe(200);
  const p = await openPrint(page, "imperial");

  const spec = sheet(p, "Crate spec");
  await expect(spec).toContainText(/Ships as \d+ × crate A \(\d+ each\) \+ 1 × crate B \(\d+\)/);
  await expect(spec.getByRole("region", { name: /^Crate A: \d+ × Machined steel bracket/ })).toBeVisible();
  await expect(spec.getByRole("region", { name: /^Crate B: \d+ × Machined steel bracket/ })).toBeVisible();
  await expect(spec).toContainText("Within the per-crate limits");
  await shotSheet(spec, "26-split-spec");
  for (const t of ["A", "B"]) {
    await expect(sheet(p, `Build sheet, crate ${t}`)).toBeVisible();
    await expect(sheet(p, `Cut list and assembly, crate ${t}`)).toBeVisible();
    await expect(sheet(p, `Shipping label, crate ${t}`)).toContainText(`CRATE ${t}`);
  }
  await shotSheet(sheet(p, "Build sheet, crate B"), "26-split-build-b");
  expect(await pdfPages(p, "26-split")).toBeGreaterThanOrEqual(7);
});

test("the print route without a design says how to open it", async ({ page }) => {
  await page.goto("/print");
  await expect(page.getByRole("alert").filter({ hasText: "There is no design to print" })).toBeVisible();
});

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  attach,
  crate,
  inText,
  mmText,
  openApp,
  openPrintTab,
  openTab,
  panel,
  pollCrate,
  readDownloadText,
  setQuantity,
  setUnits,
  sheet,
  shot,
  stubPrint,
} from "./helpers";

/**
 * The print route: "Print / save PDF" in the Cut list opens it in a new tab with the design in the URL hash, and
 * that tab opens the print dialog. The document has a crate spec, a build sheet (drawings, then cut list and
 * assembly) and a shipping label per crate type, in the selected units; in print media the sheets paginate as
 * designed (spec §6.5), rendered with `page.pdf()`, the same engine as Print / Save as PDF.
 */

test.beforeEach(async ({ context }) => {
  await stubPrint(context);
});

/** Opens the print tab and waits for the page's own print call, which the stub counts. */
async function openPrint(page: Page, units: "imperial" | "metric") {
  const popup = await openPrintTab(page, units);
  await expect.poll(() => popup.evaluate(() => window.__printCalls)).toBe(1);
  return popup;
}

/** The page as a PDF in Chromium: non-empty, and the number of pages in it. The PDF goes to the report. */
async function pdfPages(p: Page, name: string, options: { printBackground?: boolean } = {}) {
  const pdf = await p.pdf({ format: "Letter", preferCSSPageSize: true, ...options });
  await attach(`${name}.pdf`, pdf, "application/pdf");
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(20_000);
  return { pdf, pages: (pdf.toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length };
}

test("Print / save PDF gives the crate spec, build sheet and label for the default design, in imperial", async ({ page }) => {
  await openApp(page);
  // The light bracket × 4 crate on its recommended layout (the app opens at the sweep's heavier crate).
  await setQuantity(page, 4);
  const { outside, quantity } = await crate(page);
  const p = await openPrint(page, "imperial");
  await expect(p).toHaveTitle(`Crate for ${quantity} × Machined steel bracket · Crate Designer`);

  const spec = sheet(p, "Crate spec");
  await expect(spec).toContainText(`Crate for ${quantity} × Machined steel bracket`);
  await expect(spec).toContainText("PART-001");
  await expect(spec).toContainText(/[\d.]+ lb/);
  await expect(spec).toContainText(`${inText(outside!)} in`);
  await expect(spec).toContainText(`${mmText(outside!)} mm`);
  await expect(spec).toContainText("Dimensional weight");
  await expect(spec).toContainText(/\d+\.\d lb\/ft³/);
  await expect(spec).toContainText("Freight class");
  await expect(spec).toContainText("The recommended layout");
  await expect(spec).toContainText("Runner-up:");
  await expect(spec).toContainText("Fits a 53' dry van");
  await expect(spec).toContainText("Every part is blocked in");
  await shot(spec, "print-spec");

  const drawings = sheet(p, "Build sheet");
  await expect(drawings).toContainText("Dimensions in inches");
  for (const view of ["Top", "Front", "End", /^Section A–A/, /^Section B–B/]) {
    await expect(drawings.getByRole("img", { name: view, exact: typeof view === "string" })).toBeVisible();
  }
  await expect(drawings.getByRole("img", { name: "Front", exact: true })).toContainText(/\d+( \d+\/\d+)?″/);
  await shot(drawings, "print-build-drawings");

  const build = sheet(p, "Cut list and assembly");
  for (const stock of [/\d\/\d″ plywood/, /\dx\d/]) await expect(build).toContainText(stock);
  await expect(build).toContainText("Floor to skids");
  await expect(build).toContainText("Wood screws, about");
  await expect(build.locator("ol > li > b")).toHaveText(["Base", "Walls", "Load the parts", "Blocking and separators", "Lid"]);
  await shot(build, "print-build-cut-list");

  const label = sheet(p, "Shipping label");
  await expect(label).toContainText("PART-001");
  await expect(label).toContainText(`${quantity} PCS`);
  await expect(label).toContainText(/\d+ LB/);
  await expect(label).toContainText("THIS SIDE UP");
  await expect(label).toContainText("FORKS");
  await expect(label).toContainText("FORK ENTRY FROM THE ENDS");
  await shot(label, "print-label");

  // Spec, drawings, cut list and label: at least four Letter pages.
  expect((await pdfPages(p, "print-default")).pages).toBeGreaterThanOrEqual(4);
});

test("the print view follows metric units", async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
  const { outside } = await crate(page);
  const p = await openPrint(page, "metric");
  const spec = sheet(p, "Crate spec");
  await expect(spec).toContainText(`${mmText(outside!)} mm`);
  await expect(spec).toContainText(/[\d.]+ kg/);
  await expect(spec).toContainText(/\d+ kg\/m³/);
  await expect(sheet(p, "Build sheet")).toContainText("Dimensions in mm");
  await expect(sheet(p, "Cut list and assembly")).toContainText(/\d+ × \d+ lumber/);
  await expect(sheet(p, "Shipping label")).toContainText(/\d+ KG/);
  await shot(spec, "print-spec-metric");
  expect((await pdfPages(p, "print-metric")).pages).toBeGreaterThanOrEqual(4);
});

test("a split shipment prints the plan and a spec, build sheet and label per crate type", async ({ page }) => {
  await openApp(page);
  await setQuantity(page, 200);
  const p = await openPrint(page, "imperial");

  const spec = sheet(p, "Crate spec");
  await expect(spec).toContainText(/Ships as \d+ × crate A \(\d+ each\) \+ \d+ × crate B \(\d+\)/);
  await expect(spec.getByRole("region", { name: /^Crate A: \d+ × Machined steel bracket/ })).toBeVisible();
  await expect(spec.getByRole("region", { name: /^Crate B: \d+ × Machined steel bracket/ })).toBeVisible();
  await expect(spec).toContainText("Within the per-crate limits");
  await shot(spec, "print-split-spec");
  for (const t of ["A", "B"]) {
    await expect(sheet(p, `Build sheet, crate ${t}`)).toBeVisible();
    await expect(sheet(p, `Cut list and assembly, crate ${t}`)).toBeVisible();
    await expect(sheet(p, `Shipping label, crate ${t}`)).toContainText(`CRATE ${t}`);
  }
  await shot(sheet(p, "Build sheet, crate B"), "print-split-build-b");
  expect((await pdfPages(p, "print-split")).pages).toBeGreaterThanOrEqual(7);
});

test("the print route without a design says how to open it", async ({ page }) => {
  await page.goto("/print");
  await expect(page.getByRole("alert").filter({ hasText: "There is no design to print" })).toBeVisible();
});

test("the print link uses the design parameter, and an old d link still opens", async ({ page }) => {
  await openApp(page);
  const p = await openPrint(page, "imperial");
  const spec = sheet(p, "Crate spec");
  // Imperial check messages carry no mm or kg.
  await expect(spec.getByRole("table")).not.toContainText(/\bmm\b|\bkg\b/);
  await p.setViewportSize({ width: 1000, height: 1400 });
  await shot(spec, "print-spec-imperial");

  const legacy = p.url().replace("#design=", "#d=");
  await p.goto("about:blank");
  await p.goto(legacy);
  await expect(sheet(p, "Crate spec")).toBeVisible();
});

// --- Print media ------------------------------------------------------------------------------------------

/** The design file of the crate on screen, from the Cut list tab's download. */
async function designText(page: Page): Promise<string> {
  await openTab(page, "Cut list");
  const [download] = await Promise.all([page.waitForEvent("download"), panel(page).getByRole("button", { name: "Download design (.json)" }).click()]);
  return readDownloadText(download);
}

const hash = (text: string, units: "imperial" | "metric") => `#design=${Buffer.from(text).toString("base64url")}&u=${units}`;

/** The text on each page of a PDF, using Ghostscript when it is installed (null when it is not). */
function pageTexts(pdf: Buffer): string[] | null {
  const dir = mkdtempSync(join(tmpdir(), "print-pdf-"));
  const file = join(dir, "doc.pdf");
  writeFileSync(file, pdf);
  const gs = (args: string[]) => execFileSync("gs", ["-q", "-dNOPAUSE", "-dBATCH", "-dNOSAFER", ...args], { encoding: "utf8", maxBuffer: 20e6 });
  try {
    const count = Number(gs(["-dNODISPLAY", "-c", `(${file}) (r) file runpdfbegin pdfpagecount = quit`]).trim());
    return Array.from({ length: count }, (_, i) => gs(["-sDEVICE=txtwrite", `-dFirstPage=${i + 1}`, `-dLastPage=${i + 1}`, "-sOutputFile=-", file]));
  } catch {
    return null;
  }
}

test("print media: the label is one page, and the assembly order stays together", async ({ page }) => {
  await openApp(page);
  // The bracket × 4 document: five pages (a larger batch's cut list runs longer).
  await setQuantity(page, 4);
  const text = await designText(page);
  await page.goto(`/print${hash(text, "imperial")}`);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByLabel("Shipping label")).toBeVisible();
  // Wait for the web fonts, as the print page does before it opens the dialog.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  const { pdf } = await pdfPages(page, "print-pagination", { printBackground: true });
  const pages = pageTexts(pdf);
  test.skip(pages === null, "Ghostscript is not installed, so the pages cannot be read back.");
  const texts = pages!;
  // Crate spec, drawings, cut list, fasteners with the assembly order, label: five pages.
  expect(texts).toHaveLength(5);
  const label = texts.filter((t) => /THIS SIDE UP/.test(t));
  expect(label).toHaveLength(1);
  // Everything on the label shares that one page, down to the fork note at its foot.
  expect(label[0]).toMatch(/PART NUMBER/);
  expect(label[0]).toMatch(/FORK ENTRY FROM THE ENDS/i);
  // The assembly order is in one piece: its first and last steps are on the same page.
  const order = texts.filter((t) => /assembly order/i.test(t));
  expect(order).toHaveLength(1);
  for (const step of ["Base", "Walls", "Load the parts", "Blocking and separators", "Lid"]) expect(order[0]).toContain(step);
  expect(order[0]).toMatch(/Screw the edge and cross cleats to the lid panel/);
});

test("the print page shows the crate the app shows: shaped blocks, gross and screws", async ({ page }) => {
  await openApp(page);
  await setUnits(page, "imperial");
  // The design is saved once the model has been measured, as a user's would be.
  await pollCrate(page, (s) => s.shapedBlocking, { timeout: 20_000 }).toBe(true);
  await openTab(page, "Overview");
  const appGross = (await panel(page).textContent())?.match(/\d+ lb/)?.[0];
  const text = await designText(page);
  expect(JSON.parse(text).part.outline).toBeTruthy();
  expect(JSON.parse(text).ranking).toBe("volume");

  await page.goto(`/print${hash(text, "imperial")}`);
  const spec = sheet(page, "Crate spec");
  await expect(spec.first()).toBeVisible();
  // No note about a different crate, and the print says what the app says.
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(appGross).toBeTruthy();
  await expect(spec.first()).toContainText(appGross!);
  await expect(page.getByRole("region", { name: "Cut list and assembly" })).toContainText("Shaped block");
});

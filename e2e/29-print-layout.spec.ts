import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openApp, openTab, panel, pollCrate, setUnits } from "./helpers";

/**
 * The print route in print media (spec §6.5): the sheets paginate as designed. Rendered with
 * `page.pdf()`, the same engine as Print / Save as PDF, then read back page by page.
 * The shipping label must be one page and the assembly order must not be split across pages.
 */

/** The design file of the crate on screen, from the Cut list tab's download. */
async function designText(page: Page, ui: { tab?: string } = {}): Promise<string> {
  await openTab(page, ui.tab ?? "Cut list");
  const [download] = await Promise.all([page.waitForEvent("download"), panel(page).getByRole("button", { name: "Download design (.json)" }).click()]);
  return readFileSync((await download.path())!, "utf8");
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
  const text = await designText(page);
  await page.goto(`/print${hash(text, "imperial")}`);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByLabel("Shipping label")).toBeVisible();
  await document_fonts(page);

  const pdf = await page.pdf({ format: "Letter", preferCSSPageSize: true, printBackground: true });
  mkdirSync("e2e/screenshots", { recursive: true });
  writeFileSync("e2e/screenshots/29-print-layout.pdf", pdf);

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

/** Waits for the web fonts, as the print page does before it opens the dialog. */
async function document_fonts(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

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
  const doc = page.locator(".print-doc");
  await expect(doc.getByLabel("Crate spec").first()).toBeVisible();
  // No note about a different crate, and the print says what the app says.
  await expect(doc.locator(".notes")).toHaveCount(0);
  expect(appGross).toBeTruthy();
  await expect(doc.locator(".sheet").first()).toContainText(appGross!);
  await expect(doc).toContainText("Shaped block");
});

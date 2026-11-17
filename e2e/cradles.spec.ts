import { expect, test, type Page } from "@playwright/test";
import {
  crate,
  cutQty,
  cutRow,
  fileInput,
  modeButton,
  openApp,
  openPrintTab,
  openTab,
  panel,
  pinnedRow,
  pollCrate,
  sampleFile,
  setQuantity,
  SHAFT,
  sheet,
  shot,
  stubPrint,
} from "./helpers";

/**
 * Cradles for long parts: the shaft (PART-002) sits in notched cradles with end stops, which show in the
 * cut list, light up in 3D from it, and are drawn on the build sheet. (The counts and sizes are the domain's
 * and are unit-tested; this proves they reach the cut list, the checks, the 3D view and the print.)
 */

test.beforeEach(async ({ context }) => {
  await stubPrint(context);
});

async function openShaft(page: Page, quantity: number) {
  await openApp(page);
  await fileInput(page).setInputFiles(sampleFile(SHAFT));
  await pollCrate(page, (s) => s.partId).toBe("PART-002");
  await setQuantity(page, quantity);
}

test("the shaft's cut list has cradle rows, and pinning one lights the cradles in 3D", async ({ page }) => {
  await openShaft(page, 4);
  // Open view: lid off and the front wall faded, so the cradles are in sight.
  await modeButton(page).click();
  await pollCrate(page, (s) => s.mode).toBe("open");

  await openTab(page, "Cut list");
  for (const piece of ["Cradle", "Stacking cradle", "End stop"]) await expect(cutRow(page, piece)).toBeVisible();
  // The shaft is held by cradles and end stops, not by posts, bearers or separators.
  for (const piece of ["Bearer", "Layer separator", "Blocking post"]) await expect(cutRow(page, piece)).toHaveCount(0);
  const qty = (await cutQty(cutRow(page, "Cradle")).textContent())!.trim();
  expect(Number(qty)).toBeGreaterThan(1);

  const cradle = cutRow(page, "Cradle");
  await cradle.hover();
  await pollCrate(page, (s) => s.hoverKey).toMatch(/^inside\|Cradle\|/);
  await cradle.click();
  await expect(cradle.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  // The pin is the cradle line (two shafts side by side in each layer give it two notches).
  expect((await crate(page)).pin).toMatch(/^inside\|Cradle\|.*\|\d+ notches$/);
  await expect(page.getByText(`Showing ${qty} × cradle`)).toBeVisible();
  await expect(pinnedRow(page)).toHaveCount(1);
  await shot(page, "cradles-pinned");

  await page.keyboard.press("Escape");
  await pollCrate(page, (s) => s.pin).toBeNull();
  await shot(page, "cradles-cut-list");
});

test("the Overview and Checks describe the cradles", async ({ page }) => {
  await openShaft(page, 1);
  await openTab(page, "Overview");
  await expect(panel(page)).toContainText(/\d+ cradles/);
  await openTab(page, "Checks");
  await expect(panel(page)).toContainText(/\d+ notched cradles hold the parts across their length, and \d+ end stops hold them along it\./);
});

test("the build sheet draws the cradles in both sections and lists them in the assembly", async ({ page }) => {
  await openShaft(page, 4);
  const print = await openPrintTab(page);
  const drawings = sheet(print, "Build sheet");
  await expect(drawings.getByRole("img", { name: /^Section A–A: .*cradles/ })).toBeVisible();
  await expect(drawings.getByRole("img", { name: /^Section B–B: .*cradles/ })).toBeVisible();
  await shot(drawings, "cradles-build-drawings");
  const build = sheet(print, "Cut list and assembly");
  for (const text of ["Cradle", "Stacking cradle", "End stop", "Cradles to floor", "notched cradles"]) await expect(build).toContainText(text);
  await shot(build, "cradles-build-cut-list");
});

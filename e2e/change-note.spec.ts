import { expect, test, type Page } from "@playwright/test";
import {
  crate,
  fileInput,
  header,
  island,
  massField,
  materialField,
  mmText,
  nameField,
  openApp,
  openTab,
  panel,
  sampleFile,
  screenBox,
  setQuantity,
  setUnits,
  SHAFT,
  shot,
  triangleGlb,
  waitForRecommended,
} from "./helpers";

/**
 * What an edit moved: a short note that fades (under the part header and at the top of the island),
 * the full before → after on hover and for screen readers, and a gold flash on the changed values.
 */

const headerNote = (page: Page) => header(page).getByTestId("change-note");
const islandNote = (page: Page) => island(page).getByTestId("change-note");
const flashes = (page: Page) => page.getByTestId("flash");

/** The gross in the header sentence ("crate gross 15.6 kg"), as a number. */
async function headerGross(page: Page) {
  return Number(/crate gross ([\d.]+)/.exec((await header(page).textContent()) ?? "")![1]);
}

/**
 * A generated 1 mm part, as in the hardening tests: the crate is the fixed minimum size, so a mass
 * edit moves only the weights. It opens at its recommended quantity; back to one part, on the Overview.
 */
async function loadTiny(page: Page) {
  await fileInput(page).setInputFiles({ name: "tiny-pin.glb", mimeType: "model/gltf-binary", buffer: triangleGlb([0.001, 0.001, 0.001]) });
  await expect(nameField(page)).toHaveValue("Tiny pin");
  await expect(header(page)).toContainText("1 × 1 × 1 mm");
  await waitForRecommended(page);
  await setQuantity(page, 1);
  await openTab(page, "Overview");
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
});

test("a mass edit updates the header gross, notes the change and flashes the Overview", async ({ page }) => {
  // Motion on for this test, so the highlight animates for the screenshot.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await loadTiny(page);
  await expect(header(page)).toContainText("kg each stand-in");
  const before = await headerGross(page);
  await expect(massField(page)).toHaveValue("10");

  await massField(page).fill("14.71");
  await massField(page).press("Enter");
  // One tiny part: the gross moves by the mass change, 4.71 kg.
  await expect.poll(() => headerGross(page)).toBeCloseTo(before + 4.71, 0);
  const after = await headerGross(page);
  await expect(headerNote(page)).toHaveText(new RegExp(`^Crate heavier: ${after.toFixed(1)} kg`));
  // The full before → after is on hover (title) and in screen-reader text.
  const detail = /^Gross \d+ → \d+ kg, parts 10 → 15 kg$/;
  await expect(headerNote(page).locator(":scope > span")).toHaveAttribute("title", detail);
  await expect(headerNote(page).getByTestId("change-note-detail")).toHaveText(/^\. Details: Gross \d+ → \d+ kg, parts 10 → 15 kg$/);
  // The changed values carry the highlight: the header gross and the Overview gross and parts.
  await expect(header(page).getByTestId("flash")).toHaveText(`${after.toFixed(1)} kg`);
  await expect(panel(page).getByTestId("flash").first()).toBeVisible();
  await expect(panel(page).getByTestId("build-chain").getByTestId("flash")).toHaveText(["14.7 kg", `${after.toFixed(1)} kg`]);
  await shot(page, "change-note-flash");
  await shot(header(page), "change-note-header");
});

test("an edit that doesn't move the crate says so", async ({ page }) => {
  await loadTiny(page);
  const before = await headerGross(page);

  // +0.1 kg on a 1 mm part: the gross moves a little, but not enough to show in the note.
  await massField(page).focus();
  await page.keyboard.press("ArrowUp");
  await expect(massField(page)).toHaveValue("10.1");
  await expect(headerNote(page)).toHaveText("No change to the crate");
  await expect.poll(() => headerGross(page)).toBeCloseTo(before + 0.1, 1);
  await expect(flashes(page)).toHaveCount(0);

  // A material doesn't change the crate either.
  await materialField(page).fill("4140 steel");
  await materialField(page).press("Enter");
  await expect(headerNote(page)).toHaveText("No change to the crate");
  await shot(header(page), "change-note-no-change");
  // The note goes after a few seconds.
  await expect(headerNote(page)).toHaveText("", { timeout: 10_000 });
});

test("a big edit gets a short note, with the full before and after on hover and for screen readers", async ({ page }) => {
  const outsideBefore = mmText((await crate(page)).outside!);
  await setQuantity(page, 200);
  await panel(page).getByLabel("Quantity").blur();
  const note = islandNote(page);
  await expect(note).toHaveText(/^Crate grew: \d+ × \d+ × \d+ mm, \d+ kg/);
  // The visible text is short; the detail (every change, before → after) is the title and hidden text.
  const visible = await note.locator(":scope > span").evaluate((el) => (el.firstChild as Text).data);
  expect(visible.length).toBeLessThan(50);
  await expect(note.locator(":scope > span")).toHaveAttribute("title", new RegExp(`^Gross \\d+ → \\d+ kg, outside ${outsideBefore} → \\d+ × \\d+ × \\d+ mm`));
  await expect(note.getByTestId("change-note-detail")).toContainText("Details: Gross");
  await shot(page, "change-note-short");

  // Imperial says it in inches and pounds.
  await setUnits(page, "imperial");
  await setQuantity(page, 4);
  await panel(page).getByLabel("Quantity").blur();
  await expect(note).toHaveText(/^Crate shrank: [\d.]+ × [\d.]+ × [\d.]+ in, \d+ lb/);
});

test("the header note stays on one line at quantity 200 and stops short of the island", async ({ page }) => {
  await fileInput(page).setInputFiles(sampleFile(SHAFT, "gearbox-cover.glb"));
  await expect(nameField(page)).toHaveValue("Gearbox cover");
  await setQuantity(page, 200);
  await panel(page).getByLabel("Quantity").blur();
  await massField(page).fill("230.5");
  await massField(page).press("Enter");

  const span = headerNote(page).locator(":scope > span");
  await expect(span).toContainText("Crate");
  const [box, line] = await Promise.all([span.boundingBox(), span.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))]);
  expect(box!.height, "one line").toBeLessThanOrEqual(line + 2);
  expect(box!.x + box!.width, "stops short of the island").toBeLessThanOrEqual((await screenBox(island(page))).left);
  await shot(page, "change-note-header-qty-200");
});

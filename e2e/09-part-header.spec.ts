import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { fileInput, island, openApp, openTab, panel, pollCrate, sampleFile, shot, triangleGlb } from "./helpers";

/**
 * The part header (#40, #39): inline underlined fields that read as a sentence, the crate
 * gross beside the mass, and a change note plus Overview highlights after an edit.
 */

const SHAFT = "PART-002-long-steel-shaft.glb";
const header = (page: Page) => page.getByRole("banner");
const nameField = (page: Page) => header(page).getByLabel("Part name");
const materialField = (page: Page) => header(page).getByLabel("Part material");
const massField = (page: Page) => header(page).getByLabel(/Mass of one part in/);
const note = (page: Page) => header(page).getByRole("status");

/** A crop of the top-left header, for the PR (saved beside the full-page shots). */
async function shotHeader(page: Page, name: string) {
  const box = (await header(page).boundingBox())!;
  mkdirSync("e2e/screenshots", { recursive: true });
  await page.screenshot({
    path: `e2e/screenshots/${name}.png`,
    clip: { x: 0, y: 0, width: Math.ceil(box.x + box.width + 60), height: Math.ceil(box.y + box.height + 16) },
  });
}

/** An unknown part: the shaft's mesh under a file name the catalog doesn't know. */
async function loadUnknown(page: Page) {
  await fileInput(page).setInputFiles(sampleFile(SHAFT, "gearbox-cover.glb"));
  await expect(nameField(page)).toHaveValue("Gearbox cover");
}

/** A generated 1 mm part, as in the hardening tests: the crate is the fixed minimum size. */
async function loadTiny(page: Page) {
  await fileInput(page).setInputFiles({ name: "tiny-pin.glb", mimeType: "model/gltf-binary", buffer: triangleGlb([0.001, 0.001, 0.001]) });
  await expect(nameField(page)).toHaveValue("Tiny pin");
  await expect(header(page)).toContainText("1 × 1 × 1 mm");
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("a catalog part reads as the same sentence, with no fields", async ({ page }) => {
  await expect(header(page)).toContainText("PART-001 · Machined steel bracket");
  await expect(header(page)).toContainText(/4140 steel · 21.5 kg each · crate gross \d+ kg/);
  await expect(header(page).locator("input")).toHaveCount(0);
  await shotHeader(page, "09-header-catalog");
});

test("each field is edited by keyboard: Tab order, Enter commits, the stand-in clears", async ({ page }) => {
  await loadUnknown(page);

  // Stand-in: the mass has a dashed gold underline and a "stand-in" tag it is described by.
  const mass = massField(page);
  await expect(mass).toHaveValue("10");
  await expect(mass).toHaveClass(/standin/);
  await expect(mass).toHaveCSS("border-bottom-style", "dashed");
  await expect(header(page)).toContainText("kg each stand-in");
  await expect(mass).toHaveAttribute("aria-describedby", "partfield-standin");
  await expect(materialField(page)).toHaveValue("");
  await expect(materialField(page)).toHaveAttribute("placeholder", "add material");
  await expect(materialField(page)).toHaveCSS("border-bottom-style", "dashed");
  await shotHeader(page, "09-header-standin");

  // No box: the field is text with an underline.
  await expect(nameField(page)).toHaveCSS("border-top-width", "0px");
  await expect(nameField(page)).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  // Name → material → mass in Tab order.
  await nameField(page).click();
  await nameField(page).press("ControlOrMeta+a");
  await page.keyboard.type("Gearbox cover, rev B");
  await expect(nameField(page)).toBeFocused();
  await expect(nameField(page)).toHaveCSS("border-bottom-color", "rgb(112, 184, 253)");
  await shotHeader(page, "09-header-focused");
  await page.keyboard.press("Enter");
  await expect(island(page).getByRole("heading", { name: "Gearbox cover, rev B", exact: true })).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(materialField(page)).toBeFocused();
  await page.keyboard.type("6061-T6 aluminum");
  await page.keyboard.press("Enter");
  await expect(materialField(page)).toHaveValue("6061-T6 aluminum");

  await page.keyboard.press("Tab");
  await expect(mass).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("14.71");
  await expect(mass).not.toHaveClass(/standin/); // a draft drops the stand-in look
  await page.keyboard.press("Enter");
  await expect(mass).toHaveValue("14.71");
  await pollCrate(page, (s) => s.massAssumed).toBe(false);
  await expect(header(page)).not.toContainText("stand-in");
  await expect(mass).not.toHaveClass(/standin/);
  await expect(mass).toHaveCSS("border-bottom-style", "solid");

  // ↑ / ↓ step 0.1 kg, Shift for 1 kg.
  await page.keyboard.press("ArrowUp");
  await expect(mass).toHaveValue("14.81");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(mass).toHaveValue("13.81");

  await openTab(page, "Overview");
  await expect(panel(page)).toContainText("13.81 kg, 6061-T6 aluminum");
  await nameField(page).blur();
  await shotHeader(page, "09-header-default");
});

test("an invalid value shows its reason; Escape and blur revert it", async ({ page }) => {
  await loadUnknown(page);
  const mass = massField(page);

  await mass.fill("abc");
  const reason = header(page).locator("#partfield-mass-error");
  await expect(reason).toHaveText("Enter a number of kg, like 12.5.");
  await expect(mass).toHaveAttribute("aria-invalid", "true");
  await expect(mass).toHaveAttribute("aria-describedby", /partfield-mass-error/);
  await expect(mass).toHaveCSS("border-bottom-color", "rgb(243, 160, 0)");
  await expect(mass).toHaveCSS("border-bottom-style", "solid");
  // Enter doesn't save invalid text.
  await mass.press("Enter");
  await expect(reason).toBeVisible();
  await shotHeader(page, "09-header-invalid");

  await mass.press("Escape");
  await expect(mass).toHaveValue("10");
  await expect(reason).toHaveCount(0);
  await expect(mass).not.toHaveAttribute("aria-invalid", "true");
  await pollCrate(page, (s) => s.massAssumed).toBe(true);

  // A blank name is refused too, and blur puts the last valid name back.
  await nameField(page).fill("");
  await expect(header(page).locator("#partfield-name-error")).toHaveText("Enter a part name.");
  await nameField(page).blur();
  await expect(nameField(page)).toHaveValue("Gearbox cover");
  await expect(header(page).locator("#partfield-name-error")).toHaveCount(0);
});

test("a mass edit updates the header gross, notes the change and flashes the Overview", async ({ page }) => {
  // Motion on for this test, so the highlight animates for the screenshot.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await loadTiny(page);
  await expect(header(page)).toContainText("kg each stand-in · crate gross 16 kg");
  await expect(massField(page)).toHaveValue("10");

  await massField(page).fill("14.71");
  await massField(page).press("Enter");
  await expect(header(page)).toContainText("kg each · crate gross 20 kg");
  await expect(note(page)).toHaveText("Gross 16 → 20 kg, parts 10 → 15 kg");
  // The changed values carry the highlight: the header gross and the Overview gross and parts.
  await expect(header(page).locator(".flash")).toHaveText("20 kg");
  await expect(panel(page).locator(".flash").first()).toBeVisible();
  await expect(panel(page).locator(".chain .flash")).toHaveText(["15 kg", "20 kg"]);
  await shot(page, "09-change-flash");
  await shotHeader(page, "09-header-change-note");
});

test("an edit that doesn't move the crate says so", async ({ page }) => {
  await loadTiny(page);

  // +0.1 kg on a 1 mm part: the gross still rounds to 16 kg.
  await massField(page).focus();
  await page.keyboard.press("ArrowUp");
  await expect(massField(page)).toHaveValue("10.1");
  await expect(note(page)).toHaveText("No change to the crate");
  await expect(header(page)).toContainText("crate gross 16 kg");
  await expect(panel(page).locator(".flash")).toHaveCount(0);

  // A material doesn't change the crate either.
  await materialField(page).fill("4140 steel");
  await materialField(page).press("Enter");
  await expect(note(page)).toHaveText("No change to the crate");
  await shotHeader(page, "09-header-no-change");
  // The note goes after a few seconds.
  await expect(note(page)).toHaveText("", { timeout: 10_000 });
});

test("imperial: mass is shown and entered in lb, stored in kg", async ({ page }) => {
  await loadUnknown(page);
  await page.getByRole("group", { name: "Units" }).getByRole("button", { name: "in lb" }).click();
  await pollCrate(page, (s) => s.units).toBe("imperial");

  const mass = massField(page);
  await expect(mass).toHaveAccessibleName("Mass of one part in pounds");
  await expect(mass).toHaveValue("22.05");
  await expect(header(page)).toContainText(/lb each stand-in · crate gross \d+ lb/);

  await mass.fill("30");
  await mass.press("Enter");
  await expect(mass).toHaveValue("30");
  await expect(note(page)).toContainText(/Gross \d+ → \d+ lb/);
  await openTab(page, "Overview");
  await expect(panel(page)).toContainText("30 lb, material not given");
  await mass.press("ArrowUp");
  await expect(mass).toHaveValue("30.1");
  await shotHeader(page, "09-header-imperial");

  // Stored in kg: 30.1 lb is 13.653 kg.
  await page.getByRole("group", { name: "Units" }).getByRole("button", { name: "mm kg" }).click();
  await expect(massField(page)).toHaveValue("13.653");
  await expect(massField(page)).toHaveAccessibleName("Mass of one part in kilograms");
});

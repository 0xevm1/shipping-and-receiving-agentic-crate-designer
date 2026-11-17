import { expect, test, type Page } from "@playwright/test";
import {
  fileInput,
  header,
  island,
  massField,
  materialField,
  nameField,
  openApp,
  openTab,
  panel,
  pollCrate,
  sampleFile,
  setUnits,
  SHAFT,
  shot,
  waitForRecommended,
} from "./helpers";

/**
 * The part header: inline underlined fields that read as a sentence, with the crate gross beside the
 * mass. The change note and the Overview highlights after an edit are in change-note.spec.ts.
 */

/** An unknown part: the shaft's mesh under a file name the catalog doesn't know. */
async function loadUnknown(page: Page) {
  await fileInput(page).setInputFiles(sampleFile(SHAFT, "gearbox-cover.glb"));
  await expect(nameField(page)).toHaveValue("Gearbox cover");
  // It opens at its recommended quantity; edit once that has settled.
  await waitForRecommended(page);
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
});

test("a catalog part reads as the same sentence, with no fields", async ({ page }) => {
  await expect(header(page)).toContainText("PART-001 · Machined steel bracket");
  await expect(header(page)).toContainText(/4140 steel · [\d.]+ kg each · crate gross \d+ kg/);
  await expect(header(page).locator("input")).toHaveCount(0);
  await shot(header(page), "part-header-catalog");
});

test("each field is edited by keyboard: Tab order, Enter commits, the stand-in clears", async ({ page }) => {
  await loadUnknown(page);

  // Stand-in: the mass has a dashed underline and a "stand-in" tag it is described by.
  const mass = massField(page);
  await expect(mass).toHaveValue("10");
  await expect(mass).toHaveCSS("border-bottom-style", "dashed");
  await expect(header(page)).toContainText("kg each stand-in");
  await expect(mass).toHaveAttribute("aria-describedby", "partfield-standin");
  await expect(materialField(page)).toHaveValue("");
  await expect(materialField(page)).toHaveAttribute("placeholder", "add material");
  await expect(materialField(page)).toHaveCSS("border-bottom-style", "dashed");
  await shot(header(page), "part-header-standin");

  // No box: the field is text with an underline.
  await expect(nameField(page)).toHaveCSS("border-top-width", "0px");
  await expect(nameField(page)).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  // Name → material → mass in Tab order. Focus changes the underline.
  const idleUnderline = await nameField(page).evaluate((el) => getComputedStyle(el).borderBottomColor);
  await nameField(page).click();
  await nameField(page).press("ControlOrMeta+a");
  await page.keyboard.type("Gearbox cover, rev B");
  await expect(nameField(page)).toBeFocused();
  expect(await nameField(page).evaluate((el) => getComputedStyle(el).borderBottomColor), "focused underline").not.toBe(idleUnderline);
  await shot(header(page), "part-header-focused");
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
  // A draft drops the stand-in look.
  await expect(mass).toHaveCSS("border-bottom-style", "solid");
  await page.keyboard.press("Enter");
  await expect(mass).toHaveValue("14.71");
  await pollCrate(page, (s) => s.massAssumed).toBe(false);
  await expect(header(page)).not.toContainText("stand-in");
  await expect(mass).not.toHaveAttribute("aria-describedby", "partfield-standin");
  await expect(mass).toHaveCSS("border-bottom-style", "solid");

  // ↑ / ↓ step 0.1 kg, Shift for 1 kg.
  await page.keyboard.press("ArrowUp");
  await expect(mass).toHaveValue("14.81");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(mass).toHaveValue("13.81");

  await openTab(page, "Overview");
  await expect(panel(page)).toContainText("13.8 kg, 6061-T6 aluminum");
  await nameField(page).blur();
  await shot(header(page), "part-header-default");
});

test("an invalid value shows its reason; Escape and blur revert it", async ({ page }) => {
  await loadUnknown(page);
  const mass = massField(page);

  await mass.fill("abc");
  const reason = header(page).locator("#partfield-mass-error");
  await expect(reason).toHaveText("Enter a number of kg, like 12.5.");
  await expect(mass).toHaveAttribute("aria-invalid", "true");
  await expect(mass).toHaveAttribute("aria-describedby", /partfield-mass-error/);
  // An invalid value has a solid underline (not the stand-in's dashes).
  await expect(mass).toHaveCSS("border-bottom-style", "solid");
  // Enter doesn't save invalid text.
  await mass.press("Enter");
  await expect(reason).toBeVisible();
  await shot(header(page), "part-header-invalid");

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

test("imperial: mass is shown and entered in lb, stored in kg", async ({ page }) => {
  await loadUnknown(page);
  await setUnits(page, "imperial");

  const mass = massField(page);
  await expect(mass).toHaveAccessibleName("Mass of one part in pounds");
  // The 10 kg stand-in, as pounds to two decimals.
  await expect(mass).toHaveValue((10 * 2.20462).toFixed(2));
  await expect(header(page)).toContainText(/lb each stand-in · crate gross [\d,]+ lb/);

  await mass.fill("30");
  await mass.press("Enter");
  await expect(mass).toHaveValue("30");
  // At the recommended quantity a mass edit can also resize the crate; either way the note is in lb.
  await expect(header(page).getByTestId("change-note")).toContainText(/^Crate (heavier|lighter|grew|shrank)\b.*[\d,]+ lb/);
  await openTab(page, "Overview");
  await expect(panel(page)).toContainText("30 lb, material not given");
  await mass.press("ArrowUp");
  await expect(mass).toHaveValue("30.1");
  await shot(header(page), "part-header-imperial");

  // Stored in kg: 30.1 lb is 13.653 kg.
  await setUnits(page, "metric");
  await expect(massField(page)).toHaveValue((30.1 / 2.20462).toFixed(3));
  await expect(massField(page)).toHaveAccessibleName("Mass of one part in kilograms");
});

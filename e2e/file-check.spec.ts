import { expect, test, type Page } from "@playwright/test";
import {
  burger,
  closeDrawerButton,
  detailsButton,
  expectTouchSize,
  fileCheckButton,
  fileCheckDialog,
  fileInput,
  header,
  loadMessage,
  loadToast,
  massField,
  openApp,
  openTab,
  panel,
  pollCrate,
  scenarioFile,
  screenBox,
  setUnits,
  shot,
} from "./helpers";

/**
 * The file check (#106, #121, #122): what is wrong with the files someone drops is said in a line on the
 * load toast, in full in the File check report, and the part that can load, loads. The files are in
 * `fixtures/scenarios/` (`bun run fixtures`).
 */

const SIZES = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const narrow = (width: number) => width <= 980;

/** On a phone the report's button is inside the drawer; open it there first. */
async function openFileCheckButton(page: Page) {
  if (narrow(page.viewportSize()!.width)) await burger(page).click();
  await expect(fileCheckButton(page)).toBeVisible();
}

for (const { width, height } of SIZES) {
  test.describe(`${width}x${height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openApp(page);
      await setUnits(page, "metric");
    });

    test("a good entry loads, the toast names the skipped part and field, and Details lists it", async ({ page }) => {
      await fileInput(page).setInputFiles([scenarioFile("parts-missing-field.json"), scenarioFile("heavy-1500kg.glb")]);

      // The valid entry loaded with its GLB, whatever the bad one next to it.
      await expect(header(page)).toContainText("1,500 kg");
      await expect(loadMessage(page, "parts-missing-field.json: 1 entry skipped (SCN-900: mass_kg).")).toBeVisible();
      await shot(page, `file-check-toast-${width}x${height}`);

      // Details opens the report: a dialog, with focus inside it.
      await detailsButton(page).click();
      const dialog = fileCheckDialog(page);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId("file-check-counts")).toHaveText("1 error");
      await expect(dialog).toContainText("Opened heavy-1500kg.glb.");
      const finding = dialog.locator('li[data-code="missing-field"]');
      await expect(finding).toContainText("Error");
      await expect(finding).toContainText("parts[0].mass_kg");
      await expect(finding).toContainText("SCN-900 has no mass_kg, so it was skipped. Add the mass of one part in kilograms");
      await expect(dialog.getByRole("button", { name: "Close the file check" })).toBeFocused();
      await shot(page, `file-check-report-${width}x${height}`);

      // Desktop: the report sits where the island is, never over the crate.
      if (!narrow(width)) {
        const box = await screenBox(dialog);
        // The crate is framed in the space left of the island, so a report no wider than the island hides none of it.
        const island = await screenBox(page.getByRole("complementary"));
        expect(box.left).toBeGreaterThanOrEqual(island.left - 1);
        expect(box.right).toBeLessThanOrEqual(width);
      } else {
        await expectTouchSize(page, [dialog.getByRole("button", { name: "Close the file check" }), dialog.getByRole("button", { name: "Copy report" })]);
      }

      // Escape closes it and focus goes back to Details.
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(detailsButton(page)).toBeFocused();

      // The report stays reachable after the toast goes: by "Load a part", with its count.
      await page.getByRole("button", { name: "Dismiss the message" }).click();
      await openFileCheckButton(page);
      await expect(fileCheckButton(page)).toContainText("1");
      await expect(fileCheckButton(page)).toHaveAccessibleName("File check: 1 error");
      if (narrow(width)) await expectTouchSize(page, [fileCheckButton(page)]);
      await fileCheckButton(page).click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(fileCheckButton(page)).toBeFocused();

      // The Checks tab says so once, and points to the report.
      await openTab(page, "Checks");
      await expect(panel(page)).toContainText("The files had problems");
      await expect(panel(page)).toContainText("The file check found 1 error. Open File check, by Load a part");
    });

    test("two .glb files: the first opens and the report says which was opened (#121)", async ({ page }) => {
      await fileInput(page).setInputFiles([scenarioFile("heavy-1500kg.glb"), scenarioFile("tiny-light.glb")]);
      await expect(loadMessage(page, "Opened heavy-1500kg.glb. The app designs one part at a time, so tiny-light.glb was not used.")).toBeVisible();

      await detailsButton(page).click();
      const dialog = fileCheckDialog(page);
      await expect(dialog).toContainText("Opened heavy-1500kg.glb.");
      await expect(dialog.getByTestId("file-check-counts")).toHaveText("1 note");
      await expect(dialog.getByRole("heading", { name: "tiny-light.glb" })).toBeVisible();
      await expect(dialog.locator('li[data-code="glb-extra"]')).toContainText(
        "Not opened: the app designs one part at a time, and it opened heavy-1500kg.glb. Load this file on its own to design it.",
      );
      await shot(page, `file-check-two-glbs-${width}x${height}`);
    });

    test("an absurd mass loads with a warning, in the report and under the header (#122)", async ({ page }) => {
      await fileInput(page).setInputFiles([scenarioFile("parts-implausible.json"), scenarioFile("lopsided.glb")]);
      await expect(loadMessage(page, "parts-implausible.json:")).toContainText("implausible mass");
      await expect(page.getByTestId("mass-warning")).toContainText("99,999,999 kg is more than 20,000 kg");
      // The header is wide here (the file's units, a warning line), and the toast beside it still stops short of the island.
      if (!narrow(width)) {
        const islandLeft = (await screenBox(page.getByRole("complementary"))).left;
        await expect.poll(async () => (await screenBox(loadToast(page))).right).toBeLessThanOrEqual(islandLeft);
      }
      await detailsButton(page).click();
      await expect(fileCheckDialog(page).locator('li[data-code="implausible-mass"]').first()).toContainText("Warning");
      await expect(fileCheckDialog(page)).toContainText("a mass_kg of 99999999 is more than 20,000 kg");
      await shot(page, `file-check-implausible-mass-${width}x${height}`);
      await page.keyboard.press("Escape");

      // The units toggle reaches the report and the header's warning.
      await setUnits(page, "imperial");
      await expect(page.getByTestId("mass-warning")).toContainText("lb is more than 44,092 lb");
      await openFileCheckButton(page);
      await fileCheckButton(page).click();
      await expect(fileCheckDialog(page)).toContainText("is more than 44,092 lb");
    });

    test("a mass typed into the header's field gets the same warning, and a sane one clears it", async ({ page }) => {
      await fileInput(page).setInputFiles(scenarioFile("lopsided.glb"));
      await pollCrate(page, (s) => s.partId).toBe("lopsided");
      await expect(page.getByTestId("mass-warning")).toHaveCount(0);
      await massField(page).fill("99999999");
      await massField(page).press("Enter");
      await expect(page.getByTestId("mass-warning")).toContainText("99,999,999 kg is more than 20,000 kg");
      if (narrow(width)) await burger(page).click();
      await openTab(page, "Checks");
      await expect(panel(page)).toContainText("Part mass looks wrong");
      if (narrow(width)) await closeDrawerButton(page).click();
      await massField(page).fill("120");
      await massField(page).press("Enter");
      await expect(page.getByTestId("mass-warning")).toHaveCount(0);
    });

    test("a file that can't open says why, leaves the crate alone, and a clean load takes the report away", async ({ page }) => {
      await fileInput(page).setInputFiles(scenarioFile("draco.glb"));
      const alert = page.getByRole("alert").filter({ hasText: "draco.glb can't be opened. That .glb uses Draco compression" });
      await expect(alert).toBeVisible();
      await expect(header(page)).toContainText("PART-001");
      await detailsButton(page).click();
      await expect(fileCheckDialog(page)).toContainText("Nothing was opened, so the crate on screen is unchanged.");
      await page.keyboard.press("Escape");

      // The next load replaces it: a clean one says nothing and shows no entry point.
      await fileInput(page).setInputFiles(scenarioFile("tiny-light.glb"));
      await pollCrate(page, (s) => s.partId).toBe("tiny-light");
      await expect(loadMessage(page)).toHaveCount(0);
      await expect(fileCheckButton(page)).toHaveCount(0);
      await expect(fileCheckDialog(page)).toHaveCount(0);
    });
  });
}

test("the report is a keyboard trap while open, copies as plain text, and has a close that returns focus", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openApp(page);
  await setUnits(page, "metric");
  await fileInput(page).setInputFiles([scenarioFile("parts-bad-entries.json"), scenarioFile("heavy-1500kg.glb")]);
  await detailsButton(page).click();
  const dialog = fileCheckDialog(page);
  await expect(dialog.getByTestId("file-check-counts")).toHaveText("6 errors");
  await pollCrate(page, (s) => s.partId).toBe("SCN-901");

  // Tab stays inside: it comes back to the close button after the last control.
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Copy report" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close the file check" })).toBeFocused();

  await dialog.getByRole("button", { name: "Copy report" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Copied to the clipboard.");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("File check: 6 errors\nOpened heavy-1500kg.glb.\n\nparts-bad-entries.json\n");
  expect(text).toContain('  ERROR parts[1].mass_kg: SCN-910: mass_kg should be a number but is "21.5 kg"');
});

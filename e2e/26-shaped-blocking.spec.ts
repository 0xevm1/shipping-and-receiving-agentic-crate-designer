import { expect, test, type Page } from "@playwright/test";
import { crate, fileInput, openApp, openTab, panel, pollCrate, sampleFile, setUnits, shot } from "./helpers";

/**
 * Shaped blocking (#16, spec §7.5b): once the part's model has been analysed, blocking posts sit
 * where the part is solid and shaped blocks reach into its recesses. Without the analysis (here,
 * the browser never goes idle), the crate keeps its bounding-box blocking.
 */

const HOUSING = "PART-003-irregular-aluminum-housing.glb";
const modeButton = (page: Page) => page.getByRole("button", { name: /view\. Click for/ });

async function loadHousing(page: Page) {
  await openApp(page);
  await setUnits(page, "metric");
  await fileInput(page).setInputFiles(sampleFile(HOUSING));
  await pollCrate(page, (s) => s.partId).toBe("PART-003");
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill("8");
  await pollCrate(page, (s) => s.quantity).toBe(8);
}

/** Open, then exploded, with a screenshot of each. */
async function shotModes(page: Page, prefix: string) {
  await modeButton(page).click();
  await pollCrate(page, (s) => s.mode).toBe("open");
  await shot(page, `${prefix}-open`);
  await modeButton(page).click();
  await pollCrate(page, (s) => s.mode).toBe("exploded");
  await shot(page, `${prefix}-exploded`);
}

test("PART-003 × 8: blocking is shaped to the part after analysis", async ({ page }) => {
  test.slow();
  await loadHousing(page);
  await pollCrate(page, (s) => s.shapedBlocking, { timeout: 20_000 }).toBe(true);
  const { profileMs } = await crate(page);
  expect(profileMs).not.toBeNull();
  test.info().annotations.push({ type: "analysis", description: `${profileMs!.toFixed(1)} ms` });
  expect(profileMs!).toBeLessThan(1000);

  await openTab(page, /Checks/);
  await expect(panel(page)).toContainText(
    "24 blocking posts hold the parts on all four sides. They are shaped to the part with 44 shaped blocks in its recesses: " +
      "63% of the blocking face touches it (bounding box: 10%), and the most a part can shift is 0 mm (bounding box: 65 mm).",
  );
  await shot(page, "26-shaped-checks");

  await openTab(page, "Cut list");
  await expect(panel(page)).toContainText("Shaped block");

  await openTab(page, "Overview");
  await shotModes(page, "26-shaped");
});

test.describe("without the analysis", () => {
  // Analysis waits for the browser to be idle; a page that never is keeps bounding-box blocking.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.requestIdleCallback = () => 0;
    });
  });

  test("PART-003 × 8 keeps bounding-box blocking", async ({ page }) => {
    test.slow();
    await loadHousing(page);
    await openTab(page, /Checks/);
    await expect(panel(page)).toContainText("24 blocking posts hold the parts on all four sides. The smallest gap is 50 mm, between parts.");
    await expect(panel(page)).not.toContainText("shaped to the part");
    expect((await crate(page)).shapedBlocking).toBe(false);
    await shot(page, "26-bbox-checks");

    await openTab(page, "Overview");
    await shotModes(page, "26-bbox");
  });
});

import { expect, test, type Page } from "@playwright/test";
import {
  crate,
  disableShapeAnalysis,
  fileInput,
  HOUSING,
  modeButton,
  openApp,
  openTab,
  panel,
  pollCrate,
  sampleFile,
  setQuantity,
  setUnits,
  shot,
} from "./helpers";

/**
 * Shaped blocking (spec §7.5b): once the part's model has been analysed, blocking posts sit where the part is
 * solid and shaped blocks reach into its recesses. Without the analysis (here, the browser never goes idle), the
 * crate keeps its bounding-box blocking. The figures are the domain's (unit-tested); this proves the analysis
 * result reaches the design, the Checks, the cut list and the 3D view.
 */

async function loadHousing(page: Page, { measured = true } = {}) {
  await openApp(page, { measured });
  await setUnits(page, "metric");
  await fileInput(page).setInputFiles(sampleFile(HOUSING));
  await pollCrate(page, (s) => s.partId).toBe("PART-003");
  await setQuantity(page, 8);
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

const SHAPED =
  /(\d+) blocking posts hold the parts on all four sides\. They are shaped to the part with (\d+) shaped blocks in its recesses: (\d+)% of the blocking face touches it \(bounding box: (\d+)%\), and the most a part can shift is (\d+) mm \(bounding box: (\d+) mm\)\./;

test("PART-003 × 8: blocking is shaped to the part after analysis", async ({ page }) => {
  test.slow();
  await loadHousing(page);
  await pollCrate(page, (s) => s.shapedBlocking, { timeout: 20_000 }).toBe(true);
  const { profileMs } = await crate(page);
  expect(profileMs).not.toBeNull();
  test.info().annotations.push({ type: "analysis", description: `${profileMs!.toFixed(1)} ms` });
  // The analysis speed is a unit-test matter; this only guards a runaway on a busy machine.
  expect(profileMs!).toBeLessThan(15_000);

  await openTab(page, /Checks/);
  const m = SHAPED.exec((await panel(page).textContent()) ?? "");
  expect(m, "the shaped-blocking check text").not.toBeNull();
  const [, posts, blocks, touchShaped, touchBox, shiftShaped, shiftBox] = m!.map(Number);
  expect(posts).toBeGreaterThan(0);
  expect(blocks).toBeGreaterThan(0);
  // Shaping is the point: more of the face touches the part, and it can shift no more than before.
  expect(touchShaped).toBeGreaterThan(touchBox);
  expect(shiftShaped).toBeLessThanOrEqual(shiftBox);
  await shot(page, "shaped-blocking-checks");

  await openTab(page, "Cut list");
  await expect(panel(page)).toContainText("Shaped block");

  await openTab(page, "Overview");
  await shotModes(page, "shaped-blocking");
});

test.describe("without the analysis", () => {
  // Analysis waits for the browser to be idle; a page that never is keeps bounding-box blocking.
  test.beforeEach(async ({ page }) => {
    await disableShapeAnalysis(page);
  });

  test("PART-003 × 8 keeps bounding-box blocking", async ({ page }) => {
    test.slow();
    await loadHousing(page, { measured: false });
    await openTab(page, /Checks/);
    await expect(panel(page)).toContainText(/\d+ blocking posts hold the parts on all four sides\. The smallest gap is \d+ mm, between parts\./);
    await expect(panel(page)).not.toContainText("shaped to the part");
    expect((await crate(page)).shapedBlocking).toBe(false);
    await shot(page, "shaped-blocking-bbox-checks");

    await openTab(page, "Overview");
    await shotModes(page, "shaped-blocking-bbox");
  });
});

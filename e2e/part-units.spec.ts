import { expect, test, type Page } from "@playwright/test";
import { BRACKET, crate, fileInput, header, mmText, openApp, pollCrate, sampleFile, setUnits, SHAFT, shot, unitsAxisFile } from "./helpers";

/**
 * A part file that is not in metres or not Z up (#105): the header says what it was read as and
 * lets the user correct it, and the size, the crate and the 3D view follow at once. The fixtures
 * are in `fixtures/units-axis/`; the same part under a plain name is the reference crate.
 */

const unitsSelect = (page: Page) => header(page).getByLabel("File units");
const upSelect = (page: Page) => header(page).getByLabel("Up axis");

/** Loads a file and waits until it is the part on screen and its model has been measured. */
async function load(page: Page, file: ReturnType<typeof sampleFile>) {
  await fileInput(page).setInputFiles(file);
  await pollCrate(page, (s) => s.partId).toBe(file.name.replace(/\.glb$/, ""));
  await pollCrate(page, (s) => s.partFrame.drawnMm).not.toBeNull();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
});

test("a 60 in shaft is read as 60 mm until inches are picked, then it is the catalog shaft's crate", async ({ page }) => {
  // The reference: the shaft's own file under a name the catalog doesn't know (read as metres, correctly).
  await load(page, sampleFile(SHAFT, "shaft-metres.glb"));
  const want = await crate(page);
  expect(want.partFrame.units).toBe("m");

  await load(page, unitsAxisFile("shaft-inches.glb"));
  const guessed = await crate(page);
  // 60 units across is over the limit for inches, so the guess is millimetres: a 60 mm shaft.
  expect(guessed.partFrame).toMatchObject({ units: "mm", up: "z" });
  expect(guessed.partFrame.sizeMm[0]).toBeLessThan(100);
  await expect(unitsSelect(page)).toHaveValue("mm");
  await expect(header(page)).toContainText("units guessed from the size");
  await shot(page, "part-units-inches-before");

  await unitsSelect(page).selectOption("in");
  await pollCrate(page, (s) => s.partFrame.units).toBe("in");
  const fixed = await crate(page);
  fixed.partFrame.sizeMm.forEach((v, i) => expect(v).toBeCloseTo(want.partFrame.sizeMm[i], 1));
  expect(fixed.outside).toEqual(want.outside);
  expect(fixed.crateParts).toBe(want.crateParts);
  // The viewer measured the model it draws in the new units, and the header shows that size.
  await pollCrate(page, (s) => s.partFrame.drawnMm?.[0]).toBeCloseTo(want.partFrame.sizeMm[0], 1);
  await expect(header(page)).toContainText(mmText(fixed.partFrame.sizeMm));
  await expect(header(page)).toContainText("size measured from the file");
  await expect(header(page)).not.toContainText("guessed");
  await shot(page, "part-units-inches-after");
});

test("a Y-up bracket lies on its side until Y up is picked, then it sits upright like the Z-up one", async ({ page }) => {
  await load(page, sampleFile(BRACKET, "bracket-z-up.glb"));
  const want = await crate(page);

  await load(page, unitsAxisFile("bracket-y-up.glb"));
  const lying = await crate(page);
  expect(lying.partFrame).toMatchObject({ units: "m", up: "z" });
  // Read Z up, the two sides after the length are swapped: the bracket's height is its width.
  expect(lying.partFrame.sizeMm[2]).toBeCloseTo(want.partFrame.sizeMm[1], 1);
  await expect(upSelect(page)).toHaveValue("z");
  await shot(page, "part-units-yup-before");

  await upSelect(page).selectOption("y");
  await pollCrate(page, (s) => s.partFrame.up).toBe("y");
  const upright = await crate(page);
  upright.partFrame.sizeMm.forEach((v, i) => expect(v).toBeCloseTo(want.partFrame.sizeMm[i], 1));
  expect(upright.outside).toEqual(want.outside);
  // What the viewer draws stands on Z: the height it measures is the Z-up bracket's height.
  await pollCrate(page, (s) => s.partFrame.drawnMm?.[2]).toBeCloseTo(want.partFrame.sizeMm[2], 1);
  const drawn = (await crate(page)).partFrame.drawnMm!;
  drawn.forEach((v, i) => expect(v).toBeCloseTo(want.partFrame.sizeMm[i], 1));
  await expect(header(page)).toContainText(mmText(want.partFrame.sizeMm));
  await shot(page, "part-units-yup-after");
  await shot(header(page), "part-units-header");
});

test("the catalog parts offer no units or axis, and a file far from the origin loads centred", async ({ page }) => {
  await expect(unitsSelect(page)).toHaveCount(0);
  await expect(upSelect(page)).toHaveCount(0);

  const metres = await (async () => {
    await load(page, unitsAxisFile("bracket-metres.glb"));
    return crate(page);
  })();
  await load(page, unitsAxisFile("bracket-off-origin.glb"));
  const far = await crate(page);
  far.partFrame.sizeMm.forEach((v, i) => expect(v).toBeCloseTo(metres.partFrame.sizeMm[i], 1));
  expect(far.outside).toEqual(metres.outside);
  await pollCrate(page, (s) => s.partFrame.drawnMm?.[0]).toBeCloseTo(metres.partFrame.sizeMm[0], 1);
});

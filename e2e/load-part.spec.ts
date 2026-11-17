import { expect, test, type Page } from "@playwright/test";
import {
  crate,
  fileInput,
  header,
  island,
  loadMessage,
  massField,
  mmText,
  nameField,
  materialField,
  openApp,
  openTab,
  panel,
  pollCrate,
  sampleFile,
  setUnits,
  SHAFT,
  shot,
  stage,
  tab,
  triangleGlb,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
});

/** The number on the Checks tab's caution badge (0 without one). */
async function cautions(page: Page) {
  const badge = tab(page, "Checks").getByTestId("caution-count");
  return (await badge.count()) ? Number((await badge.textContent())!.match(/\d+/)![0]) : 0;
}

test("a catalog GLB fills in its mass and material", async ({ page }) => {
  await fileInput(page).setInputFiles(sampleFile(SHAFT));

  await expect(header(page)).toContainText("PART-002 · Long steel shaft");
  await expect(header(page)).toContainText(/4140 steel · [\d.]+ kg each · crate gross \d+(\.\d)? kg/);
  // Catalog parts are read-only: the same sentence, with no fields.
  await expect(header(page).locator("input")).toHaveCount(0);
  await expect(header(page)).toContainText("model matches catalog");
  await expect(island(page).getByRole("heading", { name: "Long steel shaft", exact: true })).toBeVisible();
  await pollCrate(page, (s) => s.partId).toBe("PART-002");
  await expect(panel(page)).toContainText(mmText((await crate(page)).outside!));
  await expect(massField(page)).toHaveCount(0);
  await shot(page, "load-part-catalog");
});

test("an unknown GLB uses a stand-in mass until details are entered", async ({ page }) => {
  await fileInput(page).setInputFiles(sampleFile(SHAFT, "widget_v2.glb"));

  await expect(island(page).getByRole("heading", { name: "Widget v2", exact: true })).toBeVisible();
  await expect(massField(page)).toHaveValue("10");
  await expect(header(page)).toContainText("kg each stand-in");
  await expect(header(page)).toContainText("units guessed from the size");
  // The stand-in mass adds one caution; other checks (fork entry on this narrow crate, say) may add
  // their own, so compare counts rather than fixing the badge number.
  await pollCrate(page, (s) => s.massAssumed).toBe(true);
  await expect.poll(() => cautions(page)).toBeGreaterThan(0);
  const before = await cautions(page);
  await openTab(page, /Checks/);
  await expect(panel(page)).toContainText("Part mass is a stand-in");
  await shot(page, "load-part-standin");

  // The inline fields commit on Enter.
  await nameField(page).fill("Test widget");
  await nameField(page).press("Enter");
  await materialField(page).fill("6061-T6 aluminum");
  await materialField(page).press("Enter");
  await massField(page).fill("12.5");
  await massField(page).press("Enter");

  await expect(island(page).getByRole("heading", { name: "Test widget", exact: true })).toBeVisible();
  await expect(header(page)).not.toContainText("stand-in");
  await expect.poll(() => cautions(page)).toBe(before - 1);
  await expect(panel(page)).not.toContainText("Part mass is a stand-in");
  await pollCrate(page, (s) => s.massAssumed).toBe(false);
  await openTab(page, "Overview");
  await expect(panel(page)).toContainText("12.5 kg, 6061-T6 aluminum");
  await shot(page, "load-part-details");
});

test("a text .gltf is rejected with a message, and the current part stays", async ({ page }) => {
  await fileInput(page).setInputFiles({
    name: "bracket.gltf",
    mimeType: "model/gltf+json",
    buffer: Buffer.from(JSON.stringify({ asset: { version: "2.0" } })),
  });
  await expect(loadMessage(page, "Text .gltf files can't be used. Export the part as a single .glb file.")).toBeVisible();
  await expect(header(page)).toContainText("PART-001");
  await shot(page, "load-part-gltf-rejected");
});

test("a part over 20 m is refused with a problem message", async ({ page }) => {
  // 30 000 units across, so it is read as millimetres: a 30 m part.
  await fileInput(page).setInputFiles({ name: "giant-beam.glb", mimeType: "model/gltf-binary", buffer: triangleGlb([30_000, 100, 100]) });
  const alert = panel(page).getByRole("alert");
  await expect(alert).toContainText("This part is too large to crate");
  // The size and the limit follow the units (metres here, feet in imperial).
  await expect(alert).toContainText("Its longest side is 30 m and the limit is 20 m");
  await pollCrate(page, (s) => s.problem).toBe("part-too-large");
  // A wrong guess is most often what makes a part too large, so the units stay in reach (#105).
  await expect(header(page).getByLabel("File units")).toHaveValue("mm");
  // Said once: the tabs with nothing to show are disabled, and the way out is on the card.
  for (const name of ["Layouts", "Cut list", "Rules", "Checks"]) await expect(page.getByRole("tab", { name })).toBeDisabled();
  await expect(page.getByRole("tab", { name: "Overview" })).toBeEnabled();
  await expect(alert.getByRole("button", { name: "Load another part" })).toBeVisible();
  // The canvas message is readable, not a dim line.
  await expect(stage(page).getByText("Load another part to continue.")).toBeVisible();
  await shot(page, "load-part-too-large");
});

test("dragging text over the page doesn't raise the drop veil or swallow the drop; a file drag does", async ({ page }) => {
  const veil = page.getByTestId("drop-veil");
  // A text drag has no "Files" type.
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "selected text");
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, cancelable: true }));
  });
  await expect(veil).toHaveCount(0);
  const prevented = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "selected text");
    const e = new DragEvent("drop", { dataTransfer: dt, cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(prevented).toBe(false);

  // A file drag still shows it, and the drop is read (a .txt is told to choose a .glb).
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(["hello"], "note.txt", { type: "text/plain" }));
    return d;
  });
  await page.dispatchEvent("body", "dragenter", { dataTransfer: dt });
  await expect(veil).toBeVisible();
  await page.dispatchEvent("body", "drop", { dataTransfer: dt });
  await expect(veil).toHaveCount(0);
  await expect(loadMessage(page)).toHaveText("Choose a .glb file or a design .json.");
});

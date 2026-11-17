import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { crate, fileInput, openApp, openTab, panel, pollCrate, sampleFile, setUnits, shot } from "./helpers";

/**
 * The Export pill (#51): a green pill under the part header lines downloads
 * `crate-<part>-x<qty>.zip` with the GLB(s), the PDF, the cut list(s), the design file and a
 * README. Each test unzips the download and checks every entry opens.
 */

const pill = (page: Page) => page.getByRole("banner").getByRole("button", { name: /^(Export specs|Exporting…)$/ });
const note = (page: Page) => page.getByRole("banner").locator(".exportnote");

/** Clicks Export, waits for the .zip and returns its name and entries. */
async function exportZip(page: Page) {
  const [download] = await Promise.all([page.waitForEvent("download"), pill(page).click()]);
  const name = download.suggestedFilename();
  await expect(note(page)).toHaveText(`Downloaded ${name}`);
  const path = await download.path();
  const zip = new Uint8Array(readFileSync(path));
  return { name, zip, files: unzipSync(zip) };
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

/** Binary glTF: "glTF" magic, version 2, and the length in the header matches. */
function expectGlb(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  expect(v.getUint32(0, true)).toBe(0x46546c67);
  expect(v.getUint32(4, true)).toBe(2);
  expect(v.getUint32(8, true)).toBe(b.byteLength);
}

function expectPdf(b: Uint8Array, minPages: number) {
  const s = new TextDecoder("latin1").decode(b);
  expect(s.slice(0, 5)).toBe("%PDF-");
  expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
  expect((s.match(/\/Type \/Page\b(?!s)/g) ?? []).length).toBeGreaterThanOrEqual(minPages);
  return s;
}

/** Loads the zip's design.json back through Load a part. */
async function reimport(page: Page, design: Uint8Array, extra: { name: string; mimeType: string; buffer: Buffer }[] = []) {
  await fileInput(page).setInputFiles([{ name: "design.json", mimeType: "application/json", buffer: Buffer.from(design) }, ...extra]);
  await expect(page.locator(".loadmsg")).toContainText("Design loaded");
}

test("Export downloads one .zip with every file, in imperial, and the design re-imports", async ({ page }) => {
  await openApp(page);
  await expect(pill(page)).toHaveText("Export specs");
  await expect(pill(page)).toBeEnabled();
  // The pill is under the part lines, left-aligned with them.
  const meta = await page.locator(".partmeta").boundingBox();
  const box = await pill(page).boundingBox();
  expect(box!.y).toBeGreaterThan(meta!.y + meta!.height - 1);
  expect(Math.abs(box!.x - meta!.x)).toBeLessThan(6);
  await shot(page, "19-export-idle");

  const before = (await crate(page)).outside;
  const { name, files } = await exportZip(page);
  await shot(page, "19-export-success");
  expect(name).toBe("crate-PART-001-x4.zip");
  expect(Object.keys(files).sort()).toEqual(["README.txt", "crate-PART-001-x4.glb", "crate-PART-001-x4.pdf", "cut-list.csv", "design.json"]);
  expectGlb(files["crate-PART-001-x4.glb"]);
  const pdf = expectPdf(files["crate-PART-001-x4.pdf"], 4);
  expect(pdf).toContain("36 11/16 in");
  writeFileSync("e2e/screenshots/19-export.pdf", files["crate-PART-001-x4.pdf"]);
  expect(text(files["cut-list.csv"])).toContain("# Units: inches");
  const readme = text(files["README.txt"]);
  expect(readme).toMatch(/Units: +inches and pounds/);
  expect(readme).toMatch(/App: +crate-designer \d+\.\d+\.\d+/);
  const design = JSON.parse(text(files["design.json"]));
  expect(design).toMatchObject({ kind: "crate-design", part: { id: "PART-001" }, settings: { quantity: 4 } });
  expect(design.summary.outsideMm).toEqual(before!.map(Math.round));

  // Time to design (#17): the first export stops the clock.
  await openTab(page, "Overview");
  await expect(panel(page)).toContainText(/Designed in/);

  // The design file reopens to the same crate.
  await setUnits(page, "metric");
  await reimport(page, files["design.json"]);
  await pollCrate(page, (s) => s.outside?.map(Math.round)).toEqual(design.summary.outsideMm);
});

test("Export in metric writes the CSV, PDF and README in mm and kg", async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
  const { files } = await exportZip(page);
  expect(text(files["cut-list.csv"])).toContain("# Units: mm and kg");
  expect(text(files["cut-list.csv"])).toContain("cut_mm");
  expect(expectPdf(files["crate-PART-001-x4.pdf"], 4)).toContain("932 × 652 × 497 mm");
  expect(text(files["README.txt"])).toMatch(/Units: +millimetres and kilograms/);
  expectGlb(files["crate-PART-001-x4.glb"]);
});

test("a split batch packs a GLB per crate type and the shipment cut list", async ({ page }) => {
  await openApp(page);
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill("200");
  await pollCrate(page, (s) => s.crateTypes.length).toBe(2);
  const { name, files } = await exportZip(page);
  expect(name).toBe("crate-PART-001-x200.zip");
  expect(Object.keys(files).sort()).toEqual([
    "README.txt",
    "crate-PART-001-x200-crate-A.glb",
    "crate-PART-001-x200-crate-B.glb",
    "crate-PART-001-x200.pdf",
    "cut-list-crate-A.csv",
    "cut-list-crate-B.csv",
    "design.json",
    "shipment-cut-list.csv",
  ]);
  expectGlb(files["crate-PART-001-x200-crate-A.glb"]);
  expectGlb(files["crate-PART-001-x200-crate-B.glb"]);
  const pdf = expectPdf(files["crate-PART-001-x200.pdf"], 7);
  expect(pdf).toContain("BUILD SHEET · CRATE A");
  expect(pdf).toContain("BUILD SHEET · CRATE B");
  expect(text(files["shipment-cut-list.csv"])).toMatch(/^# Shipment of 200 x PART-001/);
  const design = JSON.parse(text(files["design.json"]));
  expect(design.summary.shipment).toHaveLength(2);
});

test("a loaded (custom) part exports, and its design reopens with the GLB", async ({ page }) => {
  await openApp(page);
  const model = "PART-002-long-steel-shaft.glb";
  await fileInput(page).setInputFiles(sampleFile(model, "widget_v2.glb"));
  await pollCrate(page, (s) => s.massAssumed).toBe(true);
  const before = (await crate(page)).outside!.map(Math.round);
  const { name, files } = await exportZip(page);
  expect(name).toMatch(/^crate-[A-Za-z0-9._-]+-x\d+\.zip$/);
  const stem = name.replace(/\.zip$/, "");
  expect(Object.keys(files).sort()).toEqual(["README.txt", "cut-list.csv", "design.json", `${stem}.glb`, `${stem}.pdf`].sort());
  expectGlb(files[`${stem}.glb`]);
  expectPdf(files[`${stem}.pdf`], 4);
  const design = JSON.parse(text(files["design.json"]));
  expect(design.part).toMatchObject({ source: "custom", model: "widget_v2.glb", massAssumed: true });
  expect(text(files["README.txt"])).toContain("load widget_v2.glb with it");

  // Change the crate, then reopen the exported design with its GLB. (Not a reload: since #71 a
  // reload brings back the last crate, which would hide whether the file did the work.)
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill(String(design.settings.quantity + 3));
  await pollCrate(page, (s) => s.quantity).toBe(design.settings.quantity + 3);
  // Rules has its own file input (Load standards); leave it for Load a part's.
  await openTab(page, "Overview");
  await reimport(page, files["design.json"], [sampleFile(model, "widget_v2.glb")]);
  await pollCrate(page, (s) => s.quantity).toBe(design.settings.quantity);
  await pollCrate(page, (s) => s.outside?.map(Math.round)).toEqual(before);
});

test("the busy state holds for at least 1.5 s with motion on", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openApp(page);
  const downloaded = page.waitForEvent("download");
  const t0 = Date.now();
  await pill(page).click();
  await expect(pill(page)).toHaveText("Exporting…");
  await expect(pill(page)).toHaveAttribute("aria-busy", "true");
  await shot(page, "19-export-loading");
  await downloaded;
  expect(Date.now() - t0).toBeGreaterThanOrEqual(1400);
  await expect(note(page)).toHaveText("Downloaded crate-PART-001-x4.zip");
  await expect(pill(page)).toHaveText("Export specs");
});

test("Hide panels hides the pill with the header", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Hide panels" }).click();
  await expect(page.locator(".tl")).toHaveCSS("opacity", "0");
  await expect(page.locator(".tl")).toHaveCSS("pointer-events", "none");
});

test("on a phone the pill stays under the part lines, at touch size", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  const box = await pill(page).boundingBox();
  const meta = await page.locator(".partmeta").boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.y).toBeGreaterThan(meta!.y + meta!.height - 1);
  const { name } = await exportZip(page);
  expect(name).toBe("crate-PART-001-x4.zip");
  await shot(page, "19-export-narrow");
});

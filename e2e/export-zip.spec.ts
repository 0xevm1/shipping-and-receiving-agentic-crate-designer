import { expect, test, type Page } from "@playwright/test";
import {
  attach,
  crate,
  explode,
  fileInput,
  header,
  jsonFile,
  loadMessage,
  mmText,
  openApp,
  openTab,
  panel,
  pollCrate,
  readDownloadZip,
  roundedMm,
  sampleFile,
  setUnits,
  SHAFT,
  BRACKET,
  shot,
  waitForRecommended,
} from "./helpers";

/**
 * The Export pill: a green pill under the part header lines downloads `crate-<part>-x<qty>.zip` with the
 * GLB(s), the PDF, the cut list(s), the design file and a README. Each test unzips the download and
 * checks every entry opens.
 */

const pill = (page: Page) => header(page).getByRole("button", { name: /^(Export Packing Specs|Exporting…)$/ });
const note = (page: Page) => header(page).getByTestId("export-note");

/** Clicks Export, waits for the .zip and returns its name and entries. */
async function exportZip(page: Page) {
  const [download] = await Promise.all([page.waitForEvent("download"), pill(page).click()]);
  const name = download.suggestedFilename();
  await expect(note(page)).toHaveText(`Downloaded ${name}`);
  return { name, files: await readDownloadZip(download) };
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

/** Binary glTF: "glTF" magic, version 2, and the length in the header matches. */
function expectGlb(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  expect(v.getUint32(0, true)).toBe(0x46546c67);
  expect(v.getUint32(4, true)).toBe(2);
  expect(v.getUint32(8, true)).toBe(b.byteLength);
}

/** The node names in a .glb's JSON chunk. */
function glbNodeNames(glb: Uint8Array): string[] {
  const bytes = Buffer.from(glb);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"));
  return (json.nodes as { name?: string }[]).map((n) => n.name ?? "");
}

function expectPdf(b: Uint8Array, minPages: number) {
  const s = new TextDecoder("latin1").decode(b);
  expect(s.slice(0, 5)).toBe("%PDF-");
  expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
  expect((s.match(/\/Type \/Page\b(?!s)/g) ?? []).length).toBeGreaterThanOrEqual(minPages);
  return s;
}

/** Loads the zip's design.json back through Load a part. */
async function reimport(page: Page, design: Uint8Array, extra: ReturnType<typeof sampleFile>[] = []) {
  await fileInput(page).setInputFiles([jsonFile(text(design), "design.json"), ...extra]);
  await expect(loadMessage(page, "Design loaded")).toBeVisible();
}

test("Export downloads one .zip with every file, in imperial, and the design re-imports", async ({ page }) => {
  await openApp(page);
  await expect(pill(page)).toHaveText("Export Packing Specs");
  await expect(pill(page)).toBeEnabled();
  // The pill is under the part lines, left-aligned with them.
  const meta = (await header(page).getByTestId("part-meta").boundingBox())!;
  const box = (await pill(page).boundingBox())!;
  expect(box.y).toBeGreaterThan(meta.y + meta.height - 1);
  expect(Math.abs(box.x - meta.x)).toBeLessThan(6);
  await shot(page, "export-zip-idle");

  // The app opens at the recommended quantity (spec §7.16); the file names carry it.
  const { outside: before, quantity } = await crate(page);
  const stem = `crate-PART-001-x${quantity}`;
  const { name, files } = await exportZip(page);
  await shot(page, "export-zip-success");
  expect(name).toBe(`${stem}.zip`);
  expect(Object.keys(files).sort()).toEqual(["README.txt", `${stem}.glb`, `${stem}.pdf`, "cut-list.csv", "design.json"]);
  expectGlb(files[`${stem}.glb`]);
  const pdf = expectPdf(files[`${stem}.pdf`], 4);
  expect(pdf, "the PDF follows the units: inches, to the nearest 1/16").toMatch(/\d+( \d+\/\d+)? in/);
  await attach("export.pdf", files[`${stem}.pdf`], "application/pdf");
  expect(text(files["cut-list.csv"])).toContain("# Units: inches");
  const readme = text(files["README.txt"]);
  expect(readme).toMatch(/Units: +inches and pounds/);
  expect(readme).toMatch(/App: +crate-designer \d+\.\d+\.\d+/);
  const design = JSON.parse(text(files["design.json"]));
  expect(design).toMatchObject({ kind: "crate-design", part: { id: "PART-001" }, settings: { quantity } });
  expect(design.summary.outsideMm).toEqual(roundedMm(before!));

  // The design file reopens to the same crate.
  await setUnits(page, "metric");
  await reimport(page, files["design.json"]);
  await pollCrate(page, (s) => s.outside?.map(Math.round)).toEqual(design.summary.outsideMm);
});

test("Export in metric writes the CSV, PDF and README in mm and kg", async ({ page }) => {
  await openApp(page);
  await setUnits(page, "metric");
  const { outside, quantity } = await crate(page);
  const { files } = await exportZip(page);
  expect(text(files["cut-list.csv"])).toContain("# Units: mm and kg");
  expect(text(files["cut-list.csv"])).toContain("cut_mm");
  expect(expectPdf(files[`crate-PART-001-x${quantity}.pdf`], 4)).toContain(`${mmText(outside!)} mm`);
  expect(text(files["README.txt"])).toMatch(/Units: +millimetres and kilograms/);
  expectGlb(files[`crate-PART-001-x${quantity}.glb`]);
});

test("a split batch packs a GLB per crate type and the shipment cut list", async ({ page }) => {
  await openApp(page);
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill("200");
  await pollCrate(page, (s) => s.crateTypes.length).toBeGreaterThan(1);
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
  await fileInput(page).setInputFiles(sampleFile(SHAFT, "widget_v2.glb"));
  await pollCrate(page, (s) => s.massAssumed).toBe(true);
  // A new part opens at its recommended quantity; read the crate once that has settled.
  const before = (await waitForRecommended(page)).outside!.map(Math.round);
  const { name, files } = await exportZip(page);
  expect(name).toMatch(/^crate-[A-Za-z0-9._-]+-x\d+\.zip$/);
  const stem = name.replace(/\.zip$/, "");
  expect(Object.keys(files).sort()).toEqual(["README.txt", "cut-list.csv", "design.json", `${stem}.glb`, `${stem}.pdf`].sort());
  expectGlb(files[`${stem}.glb`]);
  expectPdf(files[`${stem}.pdf`], 4);
  const design = JSON.parse(text(files["design.json"]));
  expect(design.part).toMatchObject({ source: "custom", model: "widget_v2.glb", massAssumed: true });
  expect(text(files["README.txt"])).toContain("load widget_v2.glb with it");

  // Change the crate, then reopen the exported design with its GLB. (Not a reload: a reload brings
  // back the last crate, which would hide whether the file did the work.)
  await openTab(page, "Rules");
  await panel(page)
    .getByLabel("Quantity")
    .fill(String(design.settings.quantity + 3));
  await pollCrate(page, (s) => s.quantity).toBe(design.settings.quantity + 3);
  // Rules has its own file input (Load standards); leave it for Load a part's.
  await openTab(page, "Overview");
  await reimport(page, files["design.json"], [sampleFile(SHAFT, "widget_v2.glb")]);
  await pollCrate(page, (s) => s.quantity).toBe(design.settings.quantity);
  await pollCrate(page, (s) => s.outside?.map(Math.round)).toEqual(before);
});

test("exporting from the exploded view still packs the assembled crate", async ({ page }) => {
  await openApp(page);
  const { quantity } = await crate(page);
  await explode(page);
  const { files } = await exportZip(page);
  const names = glbNodeNames(files[`crate-PART-001-x${quantity}.glb`]);
  for (const n of ["Crate", "Base", "Side walls", "End walls", "Lid", "Side rail 1", "Parts", "Part 1", `Part ${quantity}`]) {
    expect(names).toContain(n);
  }
  expect(names).not.toContain(`Part ${quantity + 1}`);
});

test("the busy state holds for at least 1.5 s with motion on", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openApp(page);
  const { quantity } = await crate(page);
  const downloaded = page.waitForEvent("download");
  const t0 = Date.now();
  await pill(page).click();
  await expect(pill(page)).toHaveText("Exporting…");
  await expect(pill(page)).toHaveAttribute("aria-busy", "true");
  await shot(page, "export-zip-busy");
  await downloaded;
  expect(Date.now() - t0).toBeGreaterThanOrEqual(1400);
  await expect(note(page)).toHaveText(`Downloaded crate-PART-001-x${quantity}.zip`);
  await expect(pill(page)).toHaveText("Export Packing Specs");
});

test("the pill notes cautions with a dot, a title and a description; none without", async ({ page }) => {
  await openApp(page);
  const cautionPill = page.getByRole("button", { name: /Export Packing Specs/ });
  await expect(page.getByTestId("export-caution-dot")).toHaveCount(0);
  await expect(cautionPill).not.toHaveAttribute("title", /caution/);
  // A model with no catalog data comes with a stand-in mass: a caution.
  await fileInput(page).setInputFiles(sampleFile(BRACKET, "custom_widget.glb"));
  await expect(page.getByTestId("export-caution-dot")).toHaveCount(1);
  await expect(cautionPill).toHaveAttribute("title", /\d caution.*see Checks/);
  await expect(cautionPill).toHaveAccessibleDescription(/\d cautions?, see Checks/);
  await expect(cautionPill).toBeEnabled();
  await shot(header(page), "export-zip-caution");
});

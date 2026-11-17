import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { crate, fileInput, island, openApp, openTab, panel, pollCrate, sampleFile, setUnits, shot, tab, triangleGlb } from "./helpers";

/**
 * The last-opened crate (#71, spec §9): a reload reopens the crate on screen (rules, layout,
 * ranking, tab; units as before), a custom part comes back from IndexedDB, a share link wins,
 * and bad saved data opens the default part.
 */

const SHAFT = "PART-002-long-steel-shaft.glb";
const KEY = "crate-designer.last-design.v1";
const loadMessage = (page: Page) => page.locator(".loadrow .loadmsg:not(:empty)");

/** Waits for the scene after a load that may not be the default part (`openApp` expects it). */
async function waitForScene(page: Page) {
  await page.waitForFunction(() => (window.__crate?.getState().frames ?? 0) > 3, undefined, { timeout: 30_000 });
}

/** The saved entry's quantity, once the debounced save has written it. */
const savedQuantity = (page: Page) =>
  page.evaluate((key) => {
    const text = localStorage.getItem(key);
    return text ? (JSON.parse(text).design.settings.quantity as number) : null;
  }, KEY);

/** The name of the GLB kept in IndexedDB, or null. */
const keptGlb = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const req = indexedDB.open("crate-designer");
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("glb")) return resolve(null);
          const get = db.transaction("glb").objectStore("glb").get("last");
          get.onsuccess = () => resolve((get.result as { name?: string } | undefined)?.name ?? null);
          get.onerror = () => resolve(null);
        };
      }),
  );

test("a reload reopens the same crate: rules, layout, ranking, tab and units", async ({ page }) => {
  test.slow(); // a reload and several recomputes
  await openApp(page);
  await setUnits(page, "metric");
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill("8");
  await pollCrate(page, (s) => s.quantity).toBe(8);
  await panel(page).getByRole("group", { name: "Most layers allowed" }).getByRole("button", { name: "2" }).click();
  await panel(page).getByLabel("Gap between parts").fill("40");
  await openTab(page, "Layouts");
  const ranking = panel(page).getByRole("group", { name: "Rank layouts by" });
  await ranking.getByRole("button", { name: "Crate cost" }).click();
  // A layout card that isn't the recommended one.
  await panel(page).locator(`button.opt[aria-pressed="false"]`).first().click();
  const before = await crate(page);
  await expect.poll(() => savedQuantity(page)).toBe(8);
  await shot(page, "20-before-reload");
  mkdirSync("docs/screenshots/71-last-design", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/71-last-design/before-reload.png" });

  await page.reload();
  await openApp(page);
  const after = await crate(page);
  expect(after.tab).toBe("layouts");
  expect(after.units).toBe("metric");
  expect(after.partId).toBe("PART-001");
  expect(after.quantity).toBe(8);
  expect(after.outside).toEqual(before.outside);
  expect(after.crateParts).toBe(before.crateParts);
  await expect(tab(page, "Layouts")).toHaveAttribute("aria-selected", "true");
  await expect(ranking.getByRole("button", { name: "Crate cost" })).toHaveAttribute("aria-pressed", "true");
  // Reopened quietly: no load message, and the clock isn't restarted (no "Designed in").
  await expect(loadMessage(page)).toHaveCount(0);
  await shot(page, "20-after-reload");
  await page.screenshot({ path: "docs/screenshots/71-last-design/after-reload.png" });

  await openTab(page, "Rules");
  await expect(panel(page).getByLabel("Quantity")).toHaveValue("8");
  await expect(panel(page).getByRole("group", { name: "Most layers allowed" }).getByRole("button", { name: "2" })).toHaveAttribute("aria-pressed", "true");
  await expect(panel(page).getByLabel("Gap between parts")).toHaveValue("40");
  await openTab(page, "Overview");
  await expect(panel(page)).not.toContainText("Designed in");
});

test("a custom GLB comes back from IndexedDB; a bad kept model opens the default part", async ({ page }) => {
  test.slow();
  await openApp(page);
  await setUnits(page, "metric");
  await fileInput(page).setInputFiles(sampleFile(SHAFT, "widget_v2.glb"));
  await expect(island(page).getByRole("heading", { name: "Widget v2", exact: true })).toBeVisible();
  await page.getByLabel("Mass of one part in kilograms").fill("12.5");
  await page.getByLabel("Mass of one part in kilograms").press("Enter");
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill("2");
  await pollCrate(page, (s) => s.quantity).toBe(2);
  const before = await crate(page);
  await expect.poll(() => keptGlb(page)).toBe("widget_v2.glb");
  await expect.poll(() => savedQuantity(page)).toBe(2);
  await page.screenshot({ path: "docs/screenshots/71-last-design/custom-before-reload.png" });

  await page.reload();
  await waitForScene(page);
  await expect(island(page).getByRole("heading", { name: "Widget v2", exact: true })).toBeVisible();
  await pollCrate(page, (s) => s.quantity).toBe(2);
  await pollCrate(page, (s) => s.massAssumed).toBe(false);
  await pollCrate(page, (s) => s.outside).toEqual(before.outside);
  await expect(page.getByLabel("Mass of one part in kilograms")).toHaveValue("12.5");
  await page.screenshot({ path: "docs/screenshots/71-last-design/custom-after-reload.png" });

  // Damaged bytes in IndexedDB: the default part opens, without an error.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open("crate-designer");
        req.onsuccess = () => {
          const tx = req.result.transaction("glb", "readwrite");
          tx.objectStore("glb").put({ name: "widget_v2.glb", bytes: new Uint8Array([1, 2, 3]).buffer, savedAt: "" }, "last");
          tx.oncomplete = () => resolve();
        };
      }),
  );
  const errors: Error[] = [];
  page.on("pageerror", (e) => errors.push(e));
  await page.reload();
  await openApp(page);
  expect((await crate(page)).partId).toBe("PART-001");
  expect(errors).toEqual([]);
});

test("a GLB over the 50 MB cap isn't kept: the reload opens the default part and names the file", async ({ page }) => {
  test.slow();
  await openApp(page);
  // A valid GLB padded past 50 MB (one triangle, then unused bytes in the binary chunk).
  const small = triangleGlb([0.4, 0.3, 0.2]);
  const big = Buffer.concat([small, Buffer.alloc(51 * 1024 * 1024)]);
  // Fix up the header length and the BIN chunk length so it stays a valid GLB.
  const jsonLength = small.readUInt32LE(12);
  const binHeader = 20 + jsonLength;
  big.writeUInt32LE(big.length, 8);
  big.writeUInt32LE(small.readUInt32LE(binHeader) + 51 * 1024 * 1024, binHeader);
  const dir = join(tmpdir(), `crate-e2e-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "big_part.glb");
  writeFileSync(path, big);
  await fileInput(page).setInputFiles(path);
  await expect(island(page).getByRole("heading", { name: "Big part", exact: true })).toBeVisible();
  await expect.poll(async () => JSON.parse((await page.evaluate((k) => localStorage.getItem(k), KEY)) ?? "{}").design?.part?.model).toBe("big_part.glb");
  // Give the (refused) IndexedDB write time to settle; nothing is kept.
  await expect.poll(() => keptGlb(page)).toBeNull();

  await page.reload();
  await openApp(page);
  expect((await crate(page)).partId).toBe("PART-001");
  await expect(loadMessage(page)).toContainText("Load big_part.glb to reopen your last crate");
});

test("corrupt saved data opens the default part without an error", async ({ page }) => {
  await openApp(page);
  await page.evaluate((key) => localStorage.setItem(key, '{"kind":"crate-designer.last-design","version":1,"design":{oops'), KEY);
  const errors: Error[] = [];
  const warnings: string[] = [];
  page.on("pageerror", (e) => errors.push(e));
  page.on("console", (m) => m.type() === "warning" && warnings.push(m.text()));
  await page.reload();
  await openApp(page);
  const s = await crate(page);
  expect(s.partId).toBe("PART-001");
  expect(s.quantity).toBe(4);
  expect(s.tab).toBe("overview");
  await expect(loadMessage(page)).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(warnings.some((w) => w.includes("Last-opened crate ignored"))).toBe(true);
});

test("a share link wins over the remembered crate", async ({ page }) => {
  test.slow();
  await openApp(page);
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill("2");
  await pollCrate(page, (s) => s.quantity).toBe(2);
  await openTab(page, "Overview");
  const section = panel(page).getByRole("region", { name: "Saved designs" });
  await section.getByRole("button", { name: "Copy share link" }).click();
  const link = await section.getByLabel("Share link").inputValue();

  // Remember a different crate, then open the link on a fresh load.
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill("8");
  await expect.poll(() => savedQuantity(page)).toBe(8);
  await page.goto("about:blank");
  await page.goto(link);
  await waitForScene(page);
  await expect(loadMessage(page)).toContainText("Design loaded: 2 × Machined steel bracket.");
  await pollCrate(page, (s) => s.quantity).toBe(2);

  // The shared crate is now the last-opened one.
  await expect.poll(() => savedQuantity(page)).toBe(2);
  await page.reload();
  await openApp(page);
  await pollCrate(page, (s) => s.quantity).toBe(2);
});

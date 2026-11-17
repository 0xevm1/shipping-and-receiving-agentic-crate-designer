import { readFileSync } from "node:fs";
import { expect, type Locator, type Page } from "@playwright/test";
import type { CrateSnapshot } from "../src/components/viewer/E2EProbe";

export type { CrateSnapshot };

/** Reads the app's test hook (`window.__crate`, only in `NEXT_PUBLIC_E2E=1` builds). */
export function crate(page: Page): Promise<CrateSnapshot> {
  return page.evaluate(() => {
    if (!window.__crate) throw new Error("window.__crate is missing: serve a build made with NEXT_PUBLIC_E2E=1");
    return window.__crate.getState();
  });
}

/** Polls one value from the test hook until it passes `assert`. */
export function pollCrate<T>(page: Page, pick: (s: CrateSnapshot) => T, options?: { timeout?: number }) {
  return expect.poll(async () => pick(await crate(page)), options);
}

/**
 * Opens the app and waits until it is ready: the test hook is installed, the scene has drawn
 * a few frames, and the preloaded part's model has loaded (the header shows the model check).
 */
export async function openApp(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => (window.__crate?.getState().frames ?? 0) > 3, undefined, { timeout: 30_000 });
  await expect(page.getByRole("banner")).toContainText("model matches catalog", { timeout: 30_000 });
}

/** Saves a named full-page screenshot to `e2e/screenshots/` (uploaded by CI). */
export async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: true });
}

export const tab = (page: Page, name: string | RegExp): Locator => page.getByRole("tab", { name });

export async function openTab(page: Page, name: string | RegExp) {
  await tab(page, name).click();
  await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
}

export const panel = (page: Page) => page.getByRole("tabpanel");
export const island = (page: Page) => page.getByRole("complementary");

/** The hidden "Load a part" file input. */
export const fileInput = (page: Page) => island(page).locator('input[type="file"]');

/** A sample model from `public/parts/` as an in-memory upload under any file name. */
export function sampleFile(model: string, name = model) {
  return { name, mimeType: "model/gltf-binary", buffer: readFileSync(`public/parts/${model}`) };
}

/**
 * A minimal valid GLB: one triangle spanning `size` model units (x, y, z). Used for a part that
 * is read as millimetres and is over the 20 m limit.
 */
export function triangleGlb(size: [number, number, number]): Buffer {
  const [x, y, z] = size;
  const positions = new Float32Array([0, 0, 0, x, y, 0, 0, 0, z]);
  const bin = Buffer.from(positions.buffer);
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [x, y, z] }],
  };
  const pad = (b: Buffer, fill: number) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const jsonChunk = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const binChunk = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunk = (type: number, data: Buffer) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, chunk(0x4e4f534a, jsonChunk), chunk(0x004e4942, binChunk)]);
}

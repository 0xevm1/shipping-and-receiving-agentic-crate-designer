import { expect, test } from "@playwright/test";
import {
  crate,
  fileInput,
  HOUSING,
  island,
  modeButton,
  openApp,
  openTab,
  overlaps,
  panel,
  pollCrate,
  sampleFile,
  screenBox,
  SHAFT,
  shot,
  visibleLabels,
  waitForFrames,
} from "./helpers";

// The fit leaves room for the size lines, so their labels stay in the free area and never sit under
// the island, for every sample part (the long shaft's height label used to).
const cases = [
  { model: null, part: "PART-001", quantity: 4 },
  { model: SHAFT, part: "PART-002", quantity: 1 },
  { model: SHAFT, part: "PART-002", quantity: 4 },
  { model: HOUSING, part: "PART-003", quantity: 8 },
];

for (const c of cases) {
  test(`size labels stay in the free area: ${c.part} × ${c.quantity}`, async ({ page }) => {
    // A model load, a quantity change and three modes: several software-WebGL renders.
    test.slow();
    await openApp(page);
    if (c.model) {
      await fileInput(page).setInputFiles(sampleFile(c.model));
      await pollCrate(page, (s) => s.partId).toBe(c.part);
    }
    if ((await crate(page)).quantity !== c.quantity) {
      await openTab(page, "Rules");
      await panel(page).getByLabel("Quantity").fill(String(c.quantity));
      await pollCrate(page, (s) => s.quantity).toBe(c.quantity);
      await openTab(page, "Overview");
    }
    const viewport = page.viewportSize()!;
    for (const mode of ["closed", "open", "exploded"] as const) {
      await pollCrate(page, (s) => s.mode).toBe(mode);
      // The labels are positioned in `useFrame`: wait for frames after the last change.
      await waitForFrames(page, 2);
      const labels = await visibleLabels(page);
      const box = await screenBox(island(page));
      // Crate length, width and height, plus the part's one pill (its three sizes) once the inside shows.
      expect(labels.length, mode).toBe(mode === "closed" ? 3 : 4);
      for (const l of labels) {
        expect(overlaps(l, box), `${mode}: "${l.text}" is under the island`).toBe(false);
        const onScreen = l.left >= 0 && l.top >= 0 && l.right <= viewport.width && l.bottom <= viewport.height;
        expect(onScreen, `${mode}: "${l.text}" is off screen`).toBe(true);
      }
      if (mode === "closed") await shot(page, `size-labels-${c.part}-x${c.quantity}`);
      await modeButton(page).click();
    }
  });
}

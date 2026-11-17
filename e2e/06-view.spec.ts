import { readFileSync } from "node:fs";
import { expect, test, type Download, type Page } from "@playwright/test";
import { crate, fileInput, island, openApp, openTab, panel, pollCrate, sampleFile, shot } from "./helpers";

const modeButton = (page: Page) => page.getByRole("button", { name: /view\. Click for/ });
const viewButton = (page: Page) => page.getByRole("button", { name: "View", exact: true });

/** Opens the View popover and returns it (found through the button's aria-controls). */
async function openViewPopover(page: Page) {
  await viewButton(page).click();
  await expect(viewButton(page)).toHaveAttribute("aria-expanded", "true");
  const id = await viewButton(page).getAttribute("aria-controls");
  const pop = page.locator(`[id="${id}"]`);
  await expect(pop).toBeVisible();
  return pop;
}

/** Reads a downloaded .glb: checks the "glTF" header and returns the node names from its JSON chunk. */
async function glbNodeNames(download: Download): Promise<string[]> {
  const bytes = readFileSync(await download.path());
  expect(bytes.length).toBeGreaterThan(20);
  expect(bytes.subarray(0, 4).toString("ascii")).toBe("glTF");
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"));
  return (json.nodes as { name?: string }[]).map((n) => n.name ?? "");
}

test.describe("view controls", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test("the mode icon steps closed → open → exploded", async ({ page }) => {
    expect((await crate(page)).mode).toBe("closed");
    await expect(modeButton(page)).toHaveAccessibleName("Closed view. Click for open.");

    await modeButton(page).click();
    await pollCrate(page, (s) => s.anim).toEqual({ explode: 0, lidAlpha: 0, frontAlpha: 0 });
    await expect(modeButton(page)).toHaveAccessibleName("Open view. Click for exploded.");
    // The re-frame aims at the crate's middle (above the floor).
    await pollCrate(page, (s) => s.cameraTarget![1]).toBeGreaterThan(0);
    const open = await crate(page);
    expect(open.mode).toBe("open");
    await shot(page, "06-view-open");

    // Each mode frames the camera further out (MODE_ZOOM: closed 0.68, open 0.8, exploded 1).
    await modeButton(page).click();
    await pollCrate(page, (s) => s.anim).toEqual({ explode: 1, lidAlpha: 1, frontAlpha: 1 });
    await pollCrate(page, (s) => s.cameraDistance).toBeGreaterThan(open.cameraDistance! * 1.5);
    expect((await crate(page)).mode).toBe("exploded");
    await expect(modeButton(page)).toHaveAccessibleName("Exploded view. Click for closed.");
    await shot(page, "06-view-exploded");

    await modeButton(page).click();
    await pollCrate(page, (s) => s.mode).toBe("closed");
    await pollCrate(page, (s) => s.cameraDistance).toBeLessThan(open.cameraDistance! / 1.1);
    await expect(modeButton(page)).toHaveAccessibleName("Closed view. Click for open.");
  });

  // #43: the first framing used to run before OrbitControls registered, leaving the orbit target
  // on the floor (0, 0, 0) until the first re-frame.
  test("the first framing aims at the crate's middle", async ({ page }) => {
    const s = await crate(page);
    // The default crate is 497 mm tall: the target is half way up, in three.js metres (Y up).
    expect(s.cameraTarget![0]).toBeCloseTo(0, 3);
    expect(s.cameraTarget![1]).toBeCloseTo(0.497 / 2, 3);
    expect(s.cameraTarget![2]).toBeCloseTo(0, 3);
    // Camera already framed: a mode change and back lands at the same distance and target.
    const first = s.cameraDistance!;
    await modeButton(page).click();
    await pollCrate(page, (c) => c.mode).toBe("open");
    await modeButton(page).click();
    await modeButton(page).click();
    await pollCrate(page, (c) => c.mode).toBe("closed");
    await pollCrate(page, (c) => c.cameraDistance).toBeCloseTo(first, 3);
    expect((await crate(page)).cameraTarget![1]).toBeCloseTo(0.497 / 2, 3);
  });

  test("the View popover opens above the island and isn't covered", async ({ page }) => {
    const pop = await openViewPopover(page);
    const box = (await pop.boundingBox())!;
    // Sample points across the popover: each must hit the popover itself, not the island or canvas.
    const covered = await page.evaluate(
      ({ x, y, width, height, id }) => {
        const root = document.getElementById(id)!;
        const misses: string[] = [];
        for (const fx of [0.1, 0.5, 0.9]) {
          for (const fy of [0.1, 0.5, 0.9]) {
            const el = document.elementFromPoint(x + width * fx, y + height * fy);
            if (!el || !root.contains(el)) misses.push(`${fx},${fy}: ${el?.tagName}.${el?.className}`);
          }
        }
        return misses;
      },
      { ...box, id: (await pop.getAttribute("id"))! },
    );
    expect(covered).toEqual([]);
    // Every camera preset is clickable (Playwright's hit test fails if something sits on top).
    for (const name of ["3D", "Top", "Front", "End"]) {
      await pop.getByRole("button", { name, exact: true }).click({ trial: true });
    }
    await shot(page, "06-view-popover");

    // A click outside closes it.
    await page.getByRole("banner").click();
    await expect(viewButton(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("camera presets move the camera", async ({ page }) => {
    const pop = await openViewPopover(page);
    const preset = (name: string) => pop.getByRole("button", { name, exact: true });

    await preset("Top").click();
    await expect(preset("Top")).toHaveAttribute("aria-pressed", "true");
    await pollCrate(page, (s) => s.cameraAngles!.phi).toBeLessThan(0.05);
    expect((await crate(page)).view.camera).toBe("top");
    await shot(page, "06-view-top");

    await preset("Front").click();
    await pollCrate(page, (s) => s.cameraAngles!.phi).toBeCloseTo(Math.PI / 2 - 0.02, 2);
    expect((await crate(page)).cameraAngles!.theta).toBeCloseTo(0, 2);

    await preset("End").click();
    await pollCrate(page, (s) => s.cameraAngles!.theta).toBeCloseTo(-Math.PI / 2, 2);

    await preset("3D").click();
    await pollCrate(page, (s) => s.cameraAngles!.theta).toBeCloseTo(0.55, 2);
    expect((await crate(page)).cameraAngles!.phi).toBeCloseTo(Math.PI / 2 - 0.46, 2);
  });

  test("switches and Pull apart change the scene", async ({ page }) => {
    const pop = await openViewPopover(page);

    await pop.getByLabel("Lid", { exact: true }).uncheck();
    await pollCrate(page, (s) => s.anim.lidAlpha).toBe(0);
    expect((await crate(page)).mode).toBeNull();
    await expect(modeButton(page)).toHaveAccessibleName("Custom view. Click for closed.");
    await pop.getByLabel("Lid", { exact: true }).check();
    await pollCrate(page, (s) => s.mode).toBe("closed");

    await pop.getByLabel("Size labels", { exact: true }).uncheck();
    await expect(page.getByTestId("size-labels")).toHaveText("");
    await pop.getByLabel("Size labels", { exact: true }).check();
    await expect(page.getByTestId("size-labels")).toContainText("932 mm");

    await pop.getByLabel("Parts", { exact: true }).uncheck();
    await pollCrate(page, (s) => s.view.parts).toBe(false);

    await pop.getByLabel("Pull apart").fill("50");
    await pollCrate(page, (s) => s.anim.explode).toBe(0.5);
    expect((await crate(page)).mode).toBeNull();
  });

  test("Download 3D model saves the assembled crate as .glb, with or without parts", async ({ page }) => {
    // Exploded view on screen: the file must still be the assembled crate (checked in exportGlb.test.ts).
    await modeButton(page).click();
    await modeButton(page).click();
    await pollCrate(page, (s) => s.mode).toBe("exploded");

    const pop = await openViewPopover(page);
    const include = pop.getByLabel("Include parts", { exact: true });
    await expect(include).toBeChecked();
    const button = pop.getByRole("button", { name: "Download 3D model (.glb)" });
    await shot(page, "06-view-glb-export");

    const [withParts] = await Promise.all([page.waitForEvent("download"), button.click()]);
    expect(withParts.suggestedFilename()).toBe("crate-PART-001-x4.glb");
    const names = await glbNodeNames(withParts);
    for (const n of ["Crate", "Base", "Side walls", "End walls", "Lid", "Side rail 1", "Parts", "Part 1", "Part 4"]) {
      expect(names).toContain(n);
    }
    expect(names).not.toContain("Part 5");
    await expect(pop.getByRole("status")).toHaveText("3D model downloaded.");

    await include.uncheck();
    const [withoutParts] = await Promise.all([page.waitForEvent("download"), button.click()]);
    const bare = await glbNodeNames(withoutParts);
    expect(bare).toContain("Side rail 1");
    expect(bare).not.toContain("Parts");
  });

  test("Hide panels hides the island but keeps the credit", async ({ page }) => {
    const before = await crate(page);
    const credit = page.getByLabel("Hadrian × Eric White, interview candidate");
    await page.getByRole("button", { name: "Hide panels" }).click();

    await expect(page.getByRole("button", { name: "Show panels" })).toBeVisible();
    await pollCrate(page, (s) => s.panelsHidden).toBe(true);
    await expect(island(page)).toHaveCSS("opacity", "0");
    await expect(page.getByRole("banner")).toHaveCSS("opacity", "0");
    await expect(viewButton(page)).toHaveCSS("pointer-events", "none");
    await expect(credit).toBeVisible();
    await expect(credit).toHaveCSS("opacity", "1");
    await expect(credit).toContainText("HADRIAN");
    // The crate is re-framed for the bigger free area.
    await pollCrate(page, (s) => s.cameraDistance).not.toBeCloseTo(before.cameraDistance!, 2);
    await shot(page, "06-view-panels-hidden");

    await page.getByRole("button", { name: "Show panels" }).click();
    await expect(island(page)).toHaveCSS("opacity", "1");
  });
});

/**
 * Screen boxes of the visible size labels and of the island. The labels are positioned in
 * `useFrame`, so this waits two frames after the last change first (motion is reduced, so the
 * camera and explode land at once).
 */
async function labelBoxes(page: Page) {
  const frames = (await crate(page)).frames;
  // Under load, software WebGL can take seconds per frame.
  await pollCrate(page, (s) => s.frames, { timeout: 30_000 }).toBeGreaterThan(frames + 1);
  const labels = page.getByTestId("size-labels").locator(".dim");
  const boxes: { text: string; x: number; y: number; width: number; height: number }[] = [];
  for (const l of await labels.all()) {
    if (!(await l.isVisible())) continue;
    boxes.push({ text: (await l.textContent()) ?? "", ...(await l.boundingBox())! });
  }
  return { boxes, island: (await island(page).boundingBox())! };
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// #43: the fit leaves room for the size lines, so their labels stay in the free area and never
// sit under the island, for every sample part (the long shaft's height label used to).
test.describe("size labels stay in the free area", () => {
  const cases = [
    { model: null, part: "PART-001", quantity: 4 },
    { model: "PART-002-long-steel-shaft.glb", part: "PART-002", quantity: 1 },
    { model: "PART-002-long-steel-shaft.glb", part: "PART-002", quantity: 4 },
    { model: "PART-003-irregular-aluminum-housing.glb", part: "PART-003", quantity: 8 },
  ];
  for (const c of cases) {
    test(`${c.part} × ${c.quantity}`, async ({ page }) => {
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
        const { boxes, island: box } = await labelBoxes(page);
        // Crate length, width and height, plus the part's three once the inside shows.
        expect(boxes.length, mode).toBe(mode === "closed" ? 3 : 6);
        for (const b of boxes) {
          expect(overlaps(b, box), `${mode}: "${b.text}" is under the island`).toBe(false);
          const onScreen = b.x >= 0 && b.y >= 0 && b.x + b.width <= viewport.width && b.y + b.height <= viewport.height;
          expect(onScreen, `${mode}: "${b.text}" is off screen`).toBe(true);
        }
        if (mode === "closed") await shot(page, `06-labels-${c.part}-x${c.quantity}`);
        await modeButton(page).click();
      }
    });
  }
});

test.describe("idle auto-play", () => {
  // Turn motion back on for this test only: auto-play never runs with reduced motion.
  test.use({ reducedMotion: "no-preference" });

  test("starts turning the crate after 6 s without input", async ({ page }) => {
    await openApp(page);
    // Input stops auto-play at once. Point at the header so nothing in 3D is hovered (a hover holds it).
    await page.getByRole("banner").getByRole("heading", { name: "Crate Designer" }).hover();
    await pollCrate(page, (s) => s.autoplay).toBe(false);
    const stopped = Date.now();
    const theta = (await crate(page)).cameraAngles!.theta;

    await pollCrate(page, (s) => s.autoplay, { timeout: 30_000 }).toBe(true);
    // IDLE_MS is 6 s. The lower bound allows for the poll's timing; the upper one for slow CI frames.
    const waited = Date.now() - stopped;
    expect(waited).toBeGreaterThan(5_000);
    expect(waited).toBeLessThan(20_000);
    await pollCrate(page, (s) => Math.abs(s.cameraAngles!.theta - theta)).toBeGreaterThan(0.02);
  });
});

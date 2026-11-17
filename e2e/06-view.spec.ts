import { expect, test, type Page } from "@playwright/test";
import { crate, island, openApp, pollCrate, shot } from "./helpers";

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

  // Known bug, found by this suite: the first framing runs before OrbitControls registers, so the
  // orbit target stays at the floor (0, 0, 0) instead of the crate's middle until the first
  // re-frame (any mode, preset or panel change). Remove `fixme` once that is fixed.
  test.fixme("the first framing aims at the crate's middle", async ({ page }) => {
    await pollCrate(page, (s) => s.cameraTarget![1]).toBeGreaterThan(0);
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

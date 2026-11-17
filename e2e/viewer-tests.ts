import { expect, test } from "@playwright/test";
import {
  choosePreset,
  closeView,
  crate,
  explode,
  expectArrowClearOfWidthLabel,
  modeButton,
  openApp,
  overlaps,
  pollCrate,
  setUnits,
  shot,
  stage,
  visibleLabels,
  waitForFrames,
} from "./helpers";

/**
 * Viewer specs shared by the desktop and phone projects (`viewer.spec.ts`, `viewer.mobile.spec.ts`):
 * which size labels show for each camera, the part pill, the fork arrows, the fork arrow clear of the
 * width label, and a lost WebGL context. Screenshots are named for the project that ran them.
 */
export function defineViewerTests() {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await setUnits(page, "imperial");
  });

  test("a straight-on preset leaves out the dimension that points at the camera", async ({ page }) => {
    const [length, width, height] = (await crate(page)).outside!.map((v) => `${(v / 25.4).toFixed(1)} in`);
    const texts = async () => (await visibleLabels(page)).map((l) => l.text);

    await waitForFrames(page);
    expect(await texts(), "3D: length, width, height").toHaveLength(3);

    await choosePreset(page, "Top");
    await pollCrate(page, (s) => s.view.camera).toBe("top");
    await waitForFrames(page);
    expect(await texts(), "Top: no height").toEqual([length, width]);
    await shot(page, "viewer-top");

    await choosePreset(page, "Front");
    await waitForFrames(page);
    expect(await texts(), "Front: no width").toEqual([length, height]);

    await choosePreset(page, "End");
    await waitForFrames(page);
    expect(await texts(), "End: no length").toEqual([width, height]);

    await choosePreset(page, "3D");
    await waitForFrames(page);
    expect(await texts(), "3D again: all three").toHaveLength(3);
  });

  test("open and exploded show one part pill with the three sizes, and no pills overlap", async ({ page }) => {
    for (const mode of ["open", "exploded"] as const) {
      await modeButton(page).click();
      await pollCrate(page, (s) => s.mode).toBe(mode);
      if (mode === "exploded") await pollCrate(page, (s) => s.anim.explode).toBe(1);
      await pollCrate(page, (s) => s.anim.lidAlpha, { timeout: 15_000 }).toBeLessThan(1.01);
      await waitForFrames(page);
      const pills = await visibleLabels(page);
      const part = pills.filter((p) => p.part);
      expect(part, `${mode}: one part pill`).toHaveLength(1);
      expect(part[0].text).toMatch(/^\d+\.\d × \d+\.\d × \d+\.\d in$/);
      expect(
        pills.filter((p) => !p.part),
        `${mode}: three crate pills`,
      ).toHaveLength(3);
      for (let i = 0; i < pills.length; i++)
        for (let j = i + 1; j < pills.length; j++) expect(overlaps(pills[i], pills[j]), `${mode}: "${pills[i].text}" vs "${pills[j].text}"`).toBe(false);
      await shot(page, `viewer-pills-${mode}`);
    }
  });

  test("closed shows no part pill, and the pill follows the units", async ({ page }) => {
    await waitForFrames(page);
    expect((await visibleLabels(page)).some((p) => p.part)).toBe(false);
    await setUnits(page, "metric");
    await modeButton(page).click();
    await pollCrate(page, (s) => s.mode).toBe("open");
    await waitForFrames(page);
    const part = (await visibleLabels(page)).filter((p) => p.part);
    expect(part[0].text).toMatch(/^\d+ × \d+ × \d+ mm$/);
  });

  test("an end's fork arrow hides when the crate is between it and the camera", async ({ page }) => {
    await pollCrate(page, (s) => s.cog?.arrows).toBe(2);
    // 3D: both ends are beside the crate from the camera, so both show.
    await pollCrate(page, (s) => s.cog?.endsShown).toEqual([true, true]);
    // End: the camera looks along the crate from the -X end, so the +X arrow is straight behind it.
    await choosePreset(page, "End");
    await pollCrate(page, (s) => s.cog?.endsShown).toEqual([true, false]);
    await pollCrate(page, (s) => s.cog?.arrowsShown).toBe(1);
    await shot(page, "viewer-arrows-end");
    // Top: neither end is behind the crate.
    await choosePreset(page, "Top");
    await pollCrate(page, (s) => s.cog?.endsShown).toEqual([true, true]);
  });

  test("the fork arrow clears the width label, closed and exploded", async ({ page }) => {
    await expectArrowClearOfWidthLabel(page);
    await shot(page, "viewer-arrow-label-closed");
    await explode(page);
    await expectArrowClearOfWidthLabel(page);
    await shot(page, "viewer-arrow-label-exploded");
    await closeView(page);
  });

  test("a lost WebGL context shows a cover with a way back", async ({ page }) => {
    const lose = () =>
      stage(page)
        .locator("canvas")
        .first()
        .evaluate((canvas: HTMLCanvasElement) => {
          const ext = canvas.getContext("webgl2")!.getExtension("WEBGL_lose_context")!;
          (window as unknown as { __lose: typeof ext }).__lose = ext;
          ext.loseContext();
        });
    const cover = page.getByRole("alert").filter({ hasText: "The 3D view stopped" });

    // Lost: a cover that paints its own background (a canvas without its context is blank white),
    // and the way back.
    await lose();
    await expect(cover).toContainText("The 3D view stopped");
    await expect(cover.getByRole("button", { name: "Bring back the 3D view" })).toBeVisible();
    expect(await cover.evaluate((el) => getComputedStyle(el).backgroundImage), "the cover paints a background").not.toBe("none");
    await shot(page, "viewer-context-lost");

    // The browser gives the context back by itself: the cover goes.
    await page.evaluate(() => (window as unknown as { __lose: { restoreContext: () => void } }).__lose.restoreContext());
    await expect(cover).toBeHidden();
    await pollCrate(page, (s) => s.frames).toBeGreaterThan(3);

    // Lost again, and brought back with the button: a fresh canvas that draws.
    await lose();
    await expect(cover).toBeVisible();
    await cover.getByRole("button", { name: "Bring back the 3D view" }).click();
    await expect(cover).toBeHidden();
    await pollCrate(page, (s) => s.frames, { timeout: 20_000 }).toBeGreaterThan(3);
    expect(await page.evaluate(() => window.__crate!.canvasCoverage())).toBeGreaterThan(0.01);
    expect((await crate(page)).problem).toBeNull();
  });
}

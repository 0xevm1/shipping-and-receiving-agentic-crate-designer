import { expect, test, type Page } from "@playwright/test";
import { crate, openApp, pollCrate, setUnits, shot } from "./helpers";

/**
 * Viewer fixes from the #62 design review (D4, D11), shared by the desktop and phone specs
 * (30-viewer.spec.ts, 30-viewer.mobile.spec.ts). Screenshots go to e2e/screenshots/.
 */

type Box = { left: number; top: number; right: number; bottom: number };
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const modeButton = (page: Page) => page.getByRole("button", { name: /view\. Click for/ });
const labels = (page: Page) => page.getByTestId("size-labels").locator(".dim");

/** Picks a camera preset in the View popover ("3D", "Top", "Front", "End") and closes it. */
export async function choosePreset(page: Page, name: string) {
  const view = page.getByRole("button", { name: "View", exact: true });
  if ((await view.getAttribute("aria-expanded")) !== "true") await view.click();
  const pop = page.locator(`[id="${await view.getAttribute("aria-controls")}"]`);
  await pop.getByRole("button", { name, exact: true }).click();
  // Close the popover so it doesn't cover the label under test.
  if ((await view.getAttribute("aria-expanded")) === "true") await view.click();
  await expect(view).toHaveAttribute("aria-expanded", "false");
}

/** The pills on screen, with their text and screen box. */
async function visiblePills(page: Page) {
  return labels(page).evaluateAll((els) =>
    els
      .filter((el) => getComputedStyle(el).visibility === "visible")
      .map((el) => {
        const b = el.getBoundingClientRect();
        return { text: el.textContent ?? "", inner: el.classList.contains("inner"), box: { left: b.left, top: b.top, right: b.right, bottom: b.bottom } };
      }),
  );
}

/** Waits a few frames after a change so labels are positioned for the current camera. */
const settle = (page: Page) => page.waitForTimeout(700);

export function defineViewerTests() {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await setUnits(page, "imperial");
  });

  test("D11a: a straight-on preset leaves out the dimension that points at the camera", async ({ page }) => {
    await settle(page);
    expect(await visiblePills(page), "3D: length, width, height").toHaveLength(3);

    await choosePreset(page, "Top");
    await pollCrate(page, (s) => s.view.camera).toBe("top");
    await settle(page);
    const top = await visiblePills(page);
    expect(top.map((p) => p.text), "Top: no height").toEqual(["36.7 in", "25.7 in"]);
    await shot(page, `30-top-${test.info().project.name}`);

    await choosePreset(page, "Front");
    await settle(page);
    expect((await visiblePills(page)).map((p) => p.text), "Front: no width").toEqual(["36.7 in", "19.6 in"]);

    await choosePreset(page, "End");
    await settle(page);
    expect((await visiblePills(page)).map((p) => p.text), "End: no length").toEqual(["25.7 in", "19.6 in"]);

    await choosePreset(page, "3D");
    await settle(page);
    expect(await visiblePills(page), "3D again: all three").toHaveLength(3);
  });

  test("D11b: open and exploded show one part pill with the three sizes, and no pills overlap", async ({ page }) => {
    for (const mode of ["open", "exploded"] as const) {
      await modeButton(page).click();
      await pollCrate(page, (s) => s.mode).toBe(mode);
      if (mode === "exploded") await pollCrate(page, (s) => s.anim.explode).toBe(1);
      await pollCrate(page, (s) => s.anim.lidAlpha, { timeout: 15_000 }).toBeLessThan(1.01);
      await settle(page);
      const pills = await visiblePills(page);
      const part = pills.filter((p) => p.inner);
      expect(part, `${mode}: one part pill`).toHaveLength(1);
      expect(part[0].text).toMatch(/^\d+\.\d × \d+\.\d × \d+\.\d in$/);
      expect(pills.filter((p) => !p.inner), `${mode}: three crate pills`).toHaveLength(3);
      for (let i = 0; i < pills.length; i++)
        for (let j = i + 1; j < pills.length; j++)
          expect(overlaps(pills[i].box, pills[j].box), `${mode}: "${pills[i].text}" vs "${pills[j].text}"`).toBe(false);
      await shot(page, `30-pills-${mode}-${test.info().project.name}`);
    }
  });

  test("D11b: closed shows no part pill, and the pill follows the units", async ({ page }) => {
    await settle(page);
    expect((await visiblePills(page)).some((p) => p.inner)).toBe(false);
    await setUnits(page, "metric");
    await modeButton(page).click();
    await pollCrate(page, (s) => s.mode).toBe("open");
    await settle(page);
    const part = (await visiblePills(page)).filter((p) => p.inner);
    expect(part[0].text).toMatch(/^\d+ × \d+ × \d+ mm$/);
  });

  test("D11c: an end's fork arrow hides when the crate is between it and the camera", async ({ page }) => {
    await pollCrate(page, (s) => s.cog?.arrows).toBe(2);
    // 3D: both ends are beside the crate from the camera, so both show.
    await pollCrate(page, (s) => s.cog?.endsShown).toEqual([true, true]);
    // End: the camera looks along the crate from the -X end, so the +X arrow is straight behind it.
    await choosePreset(page, "End");
    await pollCrate(page, (s) => s.cog?.endsShown).toEqual([true, false]);
    await pollCrate(page, (s) => s.cog?.arrowsShown).toBe(1);
    await shot(page, `30-arrows-end-${test.info().project.name}`);
    // Top: neither end is behind the crate.
    await choosePreset(page, "Top");
    await pollCrate(page, (s) => s.cog?.endsShown).toEqual([true, true]);
  });

  test("D4: a lost WebGL context shows a cover with a way back", async ({ page }) => {
    const lose = () =>
      page.evaluate(() => {
        const canvas = document.querySelector(".stage canvas") as HTMLCanvasElement;
        const ext = canvas.getContext("webgl2")!.getExtension("WEBGL_lose_context")!;
        (window as unknown as { __lose: typeof ext }).__lose = ext;
        ext.loseContext();
      });
    const cover = page.getByRole("alert").filter({ hasText: "The 3D view stopped" });

    // Lost: the navy cover and the way back (not a white canvas).
    await lose();
    await expect(cover).toContainText("The 3D view stopped");
    await expect(cover.getByRole("button", { name: "Bring back the 3D view" })).toBeVisible();
    const bg = await cover.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg, "the cover paints the navy").toContain("rgb(0, 26, 51)");
    await shot(page, `30-context-lost-${test.info().project.name}`);

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

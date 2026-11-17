import { expect, test } from "@playwright/test";
import { header, island, openApp, openViewPopover, overlaps, screenBox, shot, stage, summary, viewButton, viewPopover } from "./helpers";

/** The View popover: where it opens, that nothing covers it, how it closes, and what it says. */

test.describe("keyboard and pointer", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await openViewPopover(page);
  });

  test("aria-controls names the popover only while it exists", async ({ page }) => {
    await expect(viewButton(page)).toHaveAttribute("aria-controls", "view-pop");
    await page.keyboard.press("Escape");
    await expect(viewPopover(page)).toHaveCount(0);
    await expect(viewButton(page)).not.toHaveAttribute("aria-controls", /.+/);
  });

  test("Escape closes it and returns focus to the View button", async ({ page }) => {
    await page.getByRole("checkbox", { name: "Lid" }).focus();
    await page.keyboard.press("Escape");
    await expect(viewPopover(page)).toHaveCount(0);
    await expect(viewButton(page)).toBeFocused();
    await expect(viewButton(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("closes when keyboard focus leaves it", async ({ page }) => {
    await page.getByRole("checkbox", { name: "Size labels" }).focus();
    // Past the last control the focus goes to the Hide panels button, outside the popover.
    await page.getByRole("slider", { name: "Pull apart" }).focus();
    await page.keyboard.press("Tab");
    await expect(viewPopover(page)).toHaveCount(0);
  });

  test("closes on a press outside, on the stage or the header", async ({ page }) => {
    await stage(page).click({ position: { x: 200, y: 400 } });
    await expect(viewPopover(page)).toHaveCount(0);

    await openViewPopover(page);
    await header(page).click();
    await expect(viewButton(page)).toHaveAttribute("aria-expanded", "false");
  });
});

test("the popover opens above the island and isn't covered; every preset is clickable", async ({ page }) => {
  await openApp(page);
  const pop = await openViewPopover(page);
  const box = (await pop.boundingBox())!;
  // Sample points across the popover: each must hit the popover itself, not the island or canvas.
  const misses = await pop.evaluate((root, { x, y, width, height }) => {
    const out: string[] = [];
    for (const fx of [0.1, 0.5, 0.9]) {
      for (const fy of [0.1, 0.5, 0.9]) {
        const el = document.elementFromPoint(x + width * fx, y + height * fy);
        if (!el || !root.contains(el)) out.push(`${fx},${fy}: ${el?.tagName}`);
      }
    }
    return out;
  }, box);
  expect(misses).toEqual([]);
  // Playwright's hit test fails if something sits on top of a preset.
  for (const name of ["3D", "Top", "Front", "End"]) {
    await pop.getByRole("button", { name, exact: true }).click({ trial: true });
  }
  await shot(page, "view-popover-open");
});

test("it names the gestures, and has no export button (Export is the pill in the header)", async ({ page }) => {
  await openApp(page);
  await expect(viewButton(page)).toHaveAttribute("title", /right-drag to pan/);
  const pop = await openViewPopover(page);
  await expect(pop).toContainText("right-drag to pan");
  await expect(pop.getByLabel("Include parts", { exact: true })).toHaveCount(0);
  await expect(pop.getByRole("button", { name: /Export/ })).toHaveCount(0);
  // Nothing floats over the stage.
  await expect(page.getByTestId("view-hint")).toHaveCount(0);
});

test.describe("placement", () => {
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [900, 800],
    [390, 844],
  ]) {
    test(`${width}×${height}: clear of the island and the summary bar, inside the window, near-opaque`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openApp(page);
      await viewButton(page).click();
      const box = await screenBox(viewPopover(page));
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
      expect(box.bottom).toBeLessThanOrEqual(height);
      if (width > 980) {
        // Desktop: the right edge is at the island's left edge, never over the scorecard.
        expect(box.right).toBeLessThanOrEqual((await screenBox(island(page))).left);
      } else {
        expect(overlaps(box, await screenBox(summary(page)))).toBe(false);
      }
      // The surface is near-opaque, so the 3D scene doesn't show through its text.
      await expectNearOpaque(viewPopover(page));
      await shot(page, `view-popover-${width}x${height}`);
    });
  }
});

async function expectNearOpaque(popover: ReturnType<typeof viewPopover>) {
  const background = await popover.evaluate((el) => getComputedStyle(el).backgroundImage);
  const alphas = [...background.matchAll(/rgba\([^)]*,\s*([\d.]+)\)/g)].map((m) => Number(m[1]));
  expect(alphas.length, `a translucent surface: ${background}`).toBeGreaterThan(0);
  for (const a of alphas) expect(a).toBeGreaterThanOrEqual(0.85);
}

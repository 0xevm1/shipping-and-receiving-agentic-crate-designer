import { expect, test } from "@playwright/test";
import { crate, hidePanelsButton, island, modeButton, openApp, openViewPopover, pollCrate, setUnits, shot, showPanelsButton, viewButton } from "./helpers";

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
  await shot(page, "view-controls-open");

  // Each mode frames the camera further out.
  await modeButton(page).click();
  await pollCrate(page, (s) => s.anim).toEqual({ explode: 1, lidAlpha: 1, frontAlpha: 1 });
  await pollCrate(page, (s) => s.cameraDistance).toBeGreaterThan(open.cameraDistance! * 1.5);
  expect((await crate(page)).mode).toBe("exploded");
  await expect(modeButton(page)).toHaveAccessibleName("Exploded view. Click for closed.");
  await shot(page, "view-controls-exploded");

  await modeButton(page).click();
  await pollCrate(page, (s) => s.mode).toBe("closed");
  await pollCrate(page, (s) => s.cameraDistance).toBeLessThan(open.cameraDistance! / 1.1);
  await expect(modeButton(page)).toHaveAccessibleName("Closed view. Click for open.");
});

// The first framing used to run before OrbitControls registered, leaving the orbit target on the
// floor (0, 0, 0) until the first re-frame.
test("the first framing aims at the crate's middle, and a mode change and back lands at the same distance", async ({ page }) => {
  const s = await crate(page);
  // Three.js metres, Y up: half the crate's height (the probe's `outside` is in mm, Z up).
  const middle = s.outside![2] / 2 / 1000;
  expect(s.cameraTarget![0]).toBeCloseTo(0, 3);
  expect(s.cameraTarget![1]).toBeCloseTo(middle, 3);
  expect(s.cameraTarget![2]).toBeCloseTo(0, 3);
  const first = s.cameraDistance!;
  await modeButton(page).click();
  await pollCrate(page, (c) => c.mode).toBe("open");
  await modeButton(page).click();
  await modeButton(page).click();
  await pollCrate(page, (c) => c.mode).toBe("closed");
  await pollCrate(page, (c) => c.cameraDistance).toBeCloseTo(first, 3);
  expect((await crate(page)).cameraTarget![1]).toBeCloseTo(middle, 3);
});

test("camera presets move the camera", async ({ page }) => {
  const pop = await openViewPopover(page);
  const preset = (name: string) => pop.getByRole("button", { name, exact: true });

  await preset("Top").click();
  await expect(preset("Top")).toHaveAttribute("aria-pressed", "true");
  await pollCrate(page, (s) => s.cameraAngles!.phi).toBeLessThan(0.05);
  expect((await crate(page)).view.camera).toBe("top");
  await shot(page, "view-controls-top");

  // Front looks along Y, level; End looks along X from the -X side.
  await preset("Front").click();
  await pollCrate(page, (s) => s.cameraAngles!.phi).toBeCloseTo(Math.PI / 2, 1);
  expect((await crate(page)).cameraAngles!.theta).toBeCloseTo(0, 2);

  await preset("End").click();
  await pollCrate(page, (s) => s.cameraAngles!.theta).toBeCloseTo(-Math.PI / 2, 2);

  // The 3D preset is a three-quarter view: turned to one side and looking down a little.
  await preset("3D").click();
  await pollCrate(page, (s) => s.cameraAngles!.theta).toBeGreaterThan(0.2);
  const { phi } = (await crate(page)).cameraAngles!;
  expect(phi).toBeGreaterThan(0.2);
  expect(phi).toBeLessThan(Math.PI / 2 - 0.2);
});

test("switches and Pull apart change the scene", async ({ page }) => {
  await setUnits(page, "metric"); // the size labels are checked in mm
  const pop = await openViewPopover(page);
  const { outside } = await crate(page);

  await pop.getByLabel("Lid", { exact: true }).uncheck();
  await pollCrate(page, (s) => s.anim.lidAlpha).toBe(0);
  expect((await crate(page)).mode).toBeNull();
  await expect(modeButton(page)).toHaveAccessibleName("Custom view. Click for closed.");
  await pop.getByLabel("Lid", { exact: true }).check();
  await pollCrate(page, (s) => s.mode).toBe("closed");

  await pop.getByLabel("Size labels", { exact: true }).uncheck();
  await expect(page.getByTestId("size-labels")).toHaveText("");
  await pop.getByLabel("Size labels", { exact: true }).check();
  await expect(page.getByTestId("size-labels")).toContainText(`${Math.round(outside![0])} mm`);

  await pop.getByLabel("Parts", { exact: true }).uncheck();
  await pollCrate(page, (s) => s.view.parts).toBe(false);

  await pop.getByLabel("Pull apart").fill("50");
  await pollCrate(page, (s) => s.anim.explode).toBe(0.5);
  expect((await crate(page)).mode).toBeNull();
});

test("Hide panels hides the island, header and Export pill for real, but keeps the credit", async ({ page }) => {
  const before = await crate(page);
  const credit = page.getByLabel("Hadrian × Eric White, interview candidate");
  await hidePanelsButton(page).click();

  await expect(showPanelsButton(page)).toBeVisible();
  await pollCrate(page, (s) => s.panelsHidden).toBe(true);
  // Hidden for real, not just transparent: out of the accessibility tree, so out of the tab order too.
  await expect(page.getByTestId("part-header")).toHaveCSS("visibility", "hidden");
  await expect(page.getByTestId("load-toast")).toHaveCSS("visibility", "hidden");
  for (const hidden of [island(page), page.getByRole("banner"), page.getByRole("button", { name: /^Export Packing Specs/ }), viewButton(page)]) {
    await expect(hidden).toHaveCount(0);
  }
  // Tab from the Show panels button never lands in a hidden control.
  await showPanelsButton(page).focus();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const a = document.activeElement;
      return { inside: !!a?.closest("aside, header"), label: a?.getAttribute("aria-label") ?? a?.textContent ?? "" };
    });
    expect(focused.inside).toBe(false);
    expect(focused.label).not.toMatch(/^(View|mm kg|in lb|Export Packing Specs)|view\. Click for/);
  }
  await expect(credit).toBeVisible();
  await expect(credit).toHaveCSS("opacity", "1");
  await expect(credit).toContainText("HADRIAN");
  // The crate is re-framed for the bigger free area.
  await pollCrate(page, (s) => s.cameraDistance).not.toBeCloseTo(before.cameraDistance!, 2);
  await shot(page, "view-controls-panels-hidden");

  await showPanelsButton(page).click();
  await expect(island(page)).toBeVisible();
  await expect(page.getByTestId("part-header")).toHaveCSS("visibility", "visible");
});

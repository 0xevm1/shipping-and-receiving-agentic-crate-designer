import { expect, test, type Page } from "@playwright/test";
import { checks, fileInput, header, layoutCards, openApp, openTab, panel, pollCrate, scenarioFile, shot, waitForRecommended } from "./helpers";

/**
 * The faces a part may rest on (#109, spec §6.2 and §7.1): choosing faces in Rules decides which orientations
 * every layout may use, and a tall part that would tip gets a one-click offer to lie down. Which orientation
 * rests on which face, and the offer's rule, are the domain's and are unit-tested (`restingFaces.test.ts`,
 * `restingFaces.tall.test.ts`); this proves the control reaches the layouts and the Checks tab.
 */

const faces = (page: Page) => panel(page).getByTestId("resting-faces");
const face = (page: Page, name: string) => faces(page).getByRole("button", { name: new RegExp(`^${name}`) });

test("the control starts as modelled, and Choose lists the six faces with their sizes", async ({ page }) => {
  await openApp(page);
  await openTab(page, "Rules");
  await expect(faces(page).getByText("Faces a part may rest on", { exact: true })).toBeVisible();
  await expect(faces(page).getByRole("button", { name: "As modelled" })).toHaveAttribute("aria-pressed", "true");
  await expect(faces(page).getByRole("button", { name: "Any face" })).toHaveAttribute("aria-pressed", "false");

  await faces(page).getByRole("button", { name: "Choose", exact: true }).click();
  for (const name of ["Bottom", "Top", "Front", "Back", "Left", "Right"]) {
    await expect(face(page, name)).toBeVisible();
    // Each face says how big it is, in the selected units.
    await expect(face(page, name)).toContainText(/\d.* × \d.* (in|mm)/);
  }
  // As modelled rests the part on its bottom only, and that last face can't be turned off.
  await expect(face(page, "Bottom")).toHaveAttribute("aria-pressed", "true");
  await expect(face(page, "Bottom")).toBeDisabled();
  await expect(face(page, "Front")).toHaveAttribute("aria-pressed", "false");
  await shot(page, "resting-faces-choose");

  await faces(page).getByRole("button", { name: "Any face" }).click();
  await expect(faces(page).getByRole("button", { name: "Any face" })).toHaveAttribute("aria-pressed", "true");
  await expect(faces(page).getByRole("button", { name: "As modelled" })).toHaveAttribute("aria-pressed", "false");
  await faces(page).getByRole("button", { name: "As modelled" }).click();
  await expect(faces(page).getByRole("button", { name: "As modelled" })).toHaveAttribute("aria-pressed", "true");
});

test("allowing only the front face makes every layout rest the part on it", async ({ page }) => {
  await openApp(page);
  await openTab(page, "Layouts");
  // As modelled: parts sit right way up, so no layout has one on its side.
  await showAllLayouts(page);
  const asModelled = await layoutCards(page).count();
  expect(asModelled).toBeGreaterThan(0);
  await expect(layoutCards(page).getByText(/^On (its|end)/)).toHaveCount(0);

  await openTab(page, "Rules");
  await faces(page).getByRole("button", { name: "Choose", exact: true }).click();
  await face(page, "Front").click();
  await expect(face(page, "Front")).toHaveAttribute("aria-pressed", "true");
  await face(page, "Bottom").click();
  await expect(face(page, "Bottom")).toHaveAttribute("aria-pressed", "false");
  // The front is the last one on now.
  await expect(face(page, "Front")).toBeDisabled();

  // The part lies on its front face in every layout: on its side, or on end turned 90°, never right way up.
  await openTab(page, "Layouts");
  await showAllLayouts(page);
  await expect.poll(() => layoutCards(page).count()).toBeGreaterThan(0);
  const onFront = layoutCards(page).getByText(/^(On its side|On end, turned 90°), \d/);
  await expect.poll(async () => (await onFront.count()) === (await layoutCards(page).count())).toBe(true);
  await expect(layoutCards(page).getByText(/^(As modeled|Turned 90°|Upside down)/)).toHaveCount(0);
  await shot(page, "resting-faces-layouts-front");

  // Back to as modelled, and the upright layouts are all there is again.
  await openTab(page, "Rules");
  await faces(page).getByRole("button", { name: "As modelled" }).click();
  await openTab(page, "Layouts");
  await showAllLayouts(page);
  await expect(layoutCards(page).getByText(/^On (its|end)/)).toHaveCount(0);
});

test("a tall part that would tip is offered the lay-down layout, and taking it clears the cautions", async ({ page }) => {
  await openApp(page);
  await fileInput(page).setInputFiles([scenarioFile("parts.json"), scenarioFile("tall-part.glb")]);
  await expect(header(page)).toContainText("Tall post");
  await waitForRecommended(page);

  // Standing up as modelled (1,200 mm tall on a 150 mm square): tip-over and top-heavy.
  await openTab(page, "Checks");
  await expect(checks(page, "caution").filter({ hasText: "Tip-over risk" })).toBeVisible();
  await expect(checks(page, "caution").filter({ hasText: "Top-heavy" })).toBeVisible();
  const offer = panel(page).getByTestId("lay-down-offer");
  await expect(offer).toContainText("Laying the parts down gives a stable crate");
  await expect(offer).toContainText(/The crate would be .* outside, clear of the tip-over and top-heavy cautions\./);
  await offer.scrollIntoViewIfNeeded();
  await shot(page, "resting-faces-lay-down-offer");

  await offer.getByRole("button", { name: /^Allow resting on the .* faces?$/ }).click();

  // The cautions about tipping are gone, the offer with them, and the rule on Rules now allows more faces.
  await expect(checks(page, "caution").filter({ hasText: "Tip-over risk" })).toHaveCount(0);
  await expect(checks(page, "caution").filter({ hasText: "Top-heavy" })).toHaveCount(0);
  await expect(checks(page, "ok").filter({ hasText: "Stable footprint" })).toBeVisible();
  await expect(offer).toHaveCount(0);
  await shot(page, "resting-faces-lay-down-taken");
  await openTab(page, "Rules");
  await expect(faces(page).getByRole("button", { name: "As modelled" })).toHaveAttribute("aria-pressed", "false");
  await pollCrate(page, (s) => s.problem).toBeNull();
});

/** The Layouts list shows the first few; opens the rest when there are more. */
async function showAllLayouts(page: Page) {
  const more = panel(page).getByRole("button", { name: /^Show all \d+ layouts$/ });
  if (await more.isVisible()) await more.click();
}

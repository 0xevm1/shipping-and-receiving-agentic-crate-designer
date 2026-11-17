import { expect, type Locator, type Page } from "@playwright/test";
import { pollCrate } from "./probe";

/** The part header, top left (the page's only banner). */
export const header = (page: Page) => page.getByRole("banner");

/** The island: a complementary region on wide screens, the "Crate details" dialog in the drawer layout. */
export const island = (page: Page) => page.getByRole("complementary").or(page.getByRole("dialog", { name: "Crate details" }));
export const panel = (page: Page) => page.getByRole("tabpanel");
export const tab = (page: Page, name: string | RegExp): Locator => page.getByRole("tab", { name });

export async function openTab(page: Page, name: string | RegExp) {
  await tab(page, name).click();
  await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
}

/**
 * The hidden "Load a part" file input (the Rules tab has its own, for standards, after it). Found through the island's
 * id, because on a narrow screen the closed drawer is out of the accessibility tree but its input still takes files.
 */
export const fileInput = (page: Page) => page.locator('#island input[type="file"]').first();

/** The part name, material and mass fields in the header (unknown parts only). */
export const nameField = (page: Page) => header(page).getByLabel("Part name");
export const materialField = (page: Page) => header(page).getByLabel("Part material");
export const massField = (page: Page) => header(page).getByLabel(/Mass of one part in/);

/** The crate and its size labels. */
export const stage = (page: Page) => page.getByRole("region", { name: "3D view of the crate" });

// --- View bar ---------------------------------------------------------------------------------

/** The mode icon: its name says the current view and what a click gives. */
export const modeButton = (page: Page) => page.getByRole("button", { name: /view\. Click for/ });
export const viewButton = (page: Page) => page.getByRole("button", { name: "View", exact: true });
export const viewPopover = (page: Page) => page.getByTestId("view-popover");
export const hidePanelsButton = (page: Page) => page.getByRole("button", { name: "Hide panels" });
export const showPanelsButton = (page: Page) => page.getByRole("button", { name: "Show panels" });

/** Opens the View popover and returns it. */
export async function openViewPopover(page: Page) {
  await viewButton(page).click();
  await expect(viewButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(viewPopover(page)).toBeVisible();
  return viewPopover(page);
}

/** Steps the view mode closed → open → exploded and waits for the probe to say so. */
export async function explode(page: Page) {
  await modeButton(page).click();
  await modeButton(page).click();
  await pollCrate(page, (s) => s.mode).toBe("exploded");
  await pollCrate(page, (s) => s.anim.explode).toBe(1);
}

/** Back to the closed view from exploded. */
export async function closeView(page: Page) {
  await modeButton(page).click();
  await pollCrate(page, (s) => s.mode).toBe("closed");
}

/** Picks a camera preset in the View popover ("3D", "Top", "Front", "End") and closes it. */
export async function choosePreset(page: Page, name: string) {
  if ((await viewButton(page).getAttribute("aria-expanded")) !== "true") await openViewPopover(page);
  await viewPopover(page).getByRole("button", { name, exact: true }).click();
  await viewButton(page).click();
  await expect(viewButton(page)).toHaveAttribute("aria-expanded", "false");
}

// --- Narrow screens: the drawer, the hamburger and the summary chip ---------------------------

export const burger = (page: Page) => page.getByRole("button", { name: "Crate details" });
export const drawer = (page: Page) => page.getByRole("dialog", { name: "Crate details" });
export const closeDrawerButton = (page: Page) => page.getByRole("button", { name: "Close the panel" });
export const summary = (page: Page) => page.getByTestId("summary");
export const scrim = (page: Page) => page.getByTestId("scrim");

/** Opens the drawer with the hamburger (a tap on phones, a click with a mouse). */
export async function openDrawer(page: Page, how: "tap" | "click" = "tap") {
  await burger(page)[how]();
  await expect(drawer(page)).toBeVisible();
  await expect(burger(page)).toHaveAttribute("aria-expanded", "true");
}

// --- Rules and Shop standards -----------------------------------------------------------------

/** Sets the batch size in Rules and waits for the store to take it. Leaves the Rules tab open. */
export async function setQuantity(page: Page, quantity: number) {
  await openTab(page, "Rules");
  await panel(page).getByLabel("Quantity").fill(String(quantity));
  await pollCrate(page, (s) => s.quantity).toBe(quantity);
}

/** The collapsible Shop standards block on the Rules tab. */
export const standards = (page: Page) => panel(page).locator("details", { hasText: "Shop standards" });

/** Opens the Rules tab and expands Shop standards (idempotent). */
export async function openStandards(page: Page) {
  await openTab(page, "Rules");
  if ((await standards(page).getAttribute("open")) === null) await standards(page).locator("summary").click();
  await expect(standards(page)).toHaveAttribute("open", "");
  return standards(page);
}

/** Fills one Shop standards field (by its label) and presses Enter. */
export async function setStandard(page: Page, label: string, value: number | string) {
  const field = (await openStandards(page)).getByLabel(label, { exact: true });
  await field.fill(String(value));
  await field.press("Enter");
  return field;
}

// --- Messages ----------------------------------------------------------------------------------

/** The toast under the part header. */
export const loadToast = (page: Page) => page.getByTestId("load-toast");

/** The toast's message, as a note (status) or an error (alert); `text` narrows it to one message. */
export const loadMessage = (page: Page, text?: string | RegExp) =>
  loadToast(page)
    .getByRole("status")
    .or(loadToast(page).getByRole("alert"))
    .filter({ hasText: text ?? /\S/ });

// --- Cut list and checks ------------------------------------------------------------------------

export const cutTable = (page: Page) => panel(page).getByRole("table");

/** Cut-list rows that can be pinned (one per piece, not the group headings). */
export const cutRows = (page: Page) =>
  cutTable(page)
    .getByRole("row")
    .filter({ has: page.getByRole("button") });

/** The cut-list row for a piece ("Skid"), pinnable. */
export const cutRow = (page: Page, piece: string) =>
  cutTable(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: piece, exact: true }) })
    .first();

/** The row's quantity cell. */
export const cutQty = (row: Locator) => row.getByTestId("cut-qty");

/** The row pinned from the list or the 3D view (its toggle is pressed). */
export const pinnedRow = (page: Page) => cutRows(page).filter({ has: page.getByRole("button", { pressed: true }) });

/** The layout cards on the Layouts tab. */
export const layoutCards = (page: Page) => panel(page).getByRole("group", { name: "Layouts", exact: true }).getByRole("button");

/** The layout card on screen (pressed): the recommended one unless another was picked. */
export const pickedLayout = (page: Page) => panel(page).getByRole("group", { name: "Layouts", exact: true }).getByRole("button", { pressed: true });

/** A layout card that isn't on screen. */
export const otherLayout = (page: Page) => panel(page).getByRole("group", { name: "Layouts", exact: true }).getByRole("button", { pressed: false });

/**
 * Opens Layouts and picks the layout ranked first ("recommended") when another is picked. The app
 * opens at the quantity sweep's crate, whose layout is the cheapest per part (spec §7.16), which
 * need not be the layout the Layouts ranking recommends. Leaves the Layouts tab open.
 */
export async function useRecommendedLayout(page: Page) {
  await openTab(page, "Layouts");
  const use = panel(page).getByRole("button", { name: "Use the recommended layout" });
  if (await use.isVisible()) await use.click();
  await expect(pickedLayout(page)).toContainText("recommended");
}

/** Every check on the Checks tab, or only those of one level. */
export const checks = (page: Page, level?: "ok" | "caution" | "info") =>
  level
    ? panel(page)
        .getByTestId("check")
        .and(page.locator(`[data-level="${level}"]`))
    : panel(page).getByTestId("check");

// --- Size labels ----------------------------------------------------------------------------------

/** The crate's length, width and height labels. */
export const crateLabels = (page: Page) => page.getByTestId("size-label");
/** The part's one pill with its three sizes (open and exploded views). */
const partLabel = (page: Page) => page.getByTestId("size-label-part");

/** Screen boxes of the visible labels, so a spec can compare them with the island or each other. */
export async function visibleLabels(page: Page) {
  const out: { text: string; part: boolean; left: number; top: number; right: number; bottom: number }[] = [];
  for (const part of [false, true]) {
    const labels = part ? partLabel(page) : crateLabels(page);
    for (const l of await labels.all()) {
      if (!(await l.isVisible())) continue;
      const b = (await l.boundingBox())!;
      out.push({ text: (await l.textContent()) ?? "", part, left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height });
    }
  }
  return out;
}

export type ScreenBox = { left: number; top: number; right: number; bottom: number };
export const overlaps = (a: ScreenBox, b: ScreenBox) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Playwright's `boundingBox()` as a ScreenBox. */
export async function screenBox(locator: Locator): Promise<ScreenBox> {
  const b = (await locator.boundingBox())!;
  return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
}

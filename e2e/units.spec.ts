import { expect, test } from "@playwright/test";
import { openApp, panel, setUnits, shot } from "./helpers";

test("units toggle switches in to mm in the header, Overview and size labels, and back", async ({ page }) => {
  await openApp(page);
  const units = page.getByRole("group", { name: "Units" });
  const header = page.getByRole("banner");
  const labels = page.getByTestId("size-labels");

  // Imperial is the default (#15).
  await expect(units.getByRole("button", { name: "in lb" })).toHaveAttribute("aria-pressed", "true");
  await expect(header).toContainText(/\d+\.\d × \d+\.\d × \d+\.\d in/);
  await expect(header).toContainText("lb each");
  await expect(panel(page)).toContainText("36.7 × 25.7 × 19.6");
  // The other-unit line under the size is in millimetres.
  await expect(panel(page)).toContainText("932 × 652 × 497 mm");
  await expect(labels).toContainText("36.7 in");
  await expect(labels).not.toContainText("mm");
  await shot(page, "04-units-imperial");

  await setUnits(page, "metric");
  await expect(header).toContainText("21.5 kg each");
  await expect(panel(page)).toContainText("36.7 × 25.7 × 19.6 in");
  await expect(labels).toContainText("932 mm");
  await shot(page, "04-units-metric");

  await setUnits(page, "imperial");
  await expect(header).toContainText("lb each");
  await expect(labels).toContainText("36.7 in");
});

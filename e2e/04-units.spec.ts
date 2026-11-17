import { expect, test } from "@playwright/test";
import { openApp, panel, pollCrate, shot } from "./helpers";

test("units toggle switches mm to in in the header, Overview and size labels", async ({ page }) => {
  await openApp(page);
  const units = page.getByRole("group", { name: "Units" });
  const header = page.getByRole("banner");
  const labels = page.getByTestId("size-labels");
  await expect(labels).toContainText("932 mm");

  await units.getByRole("button", { name: "in lb" }).click();
  await expect(units.getByRole("button", { name: "in lb" })).toHaveAttribute("aria-pressed", "true");
  await pollCrate(page, (s) => s.units).toBe("imperial");

  await expect(header).toContainText(/\d+\.\d × \d+\.\d × \d+\.\d in/);
  await expect(header).toContainText("lb each");
  await expect(panel(page)).toContainText("36.7 × 25.7 × 19.6");
  // The other-unit line under the size flips to millimetres.
  await expect(panel(page)).toContainText("932 × 652 × 497 mm");
  await expect(labels).toContainText("36.7 in");
  await expect(labels).not.toContainText("mm");
  await shot(page, "04-units-imperial");

  await units.getByRole("button", { name: "mm kg" }).click();
  await expect(header).toContainText("21.5 kg each");
  await expect(labels).toContainText("932 mm");
});

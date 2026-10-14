import { expect, type Page } from "@playwright/test";

export async function selectMapMode(
  page: Page,
  mode: "2D" | "2.5D" | "3D",
  retry = false,
) {
  await page.getByTestId("map-mode-trigger").click();
  await page
    .getByRole("menuitemradio", {
      name: retry ? "重试3D" : `切换为${mode}`,
      exact: true,
    })
    .click();
  await expect(page.getByRole("menu", { name: "地图模式" })).toHaveCount(0);
}

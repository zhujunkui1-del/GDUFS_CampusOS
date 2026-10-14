import { expect, type Page } from "@playwright/test";

export async function selectMapMode(
  page: Page,
  mode: "2D" | "2.5D" | "3D",
  allowFallback = false,
) {
  const trigger = page.getByTestId("map-mode-trigger");
  for (let i = 0; i < 4 && (await trigger.innerText()) !== mode; i++) {
    const attempted = await trigger.getAttribute("title");
    await trigger.click();
    if (attempted === `切换为${mode}`) break;
  }
  if (!allowFallback) await expect(trigger).toHaveText(mode);
  await expect(page.getByRole("menu")).toHaveCount(0);
}

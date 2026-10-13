import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("capture source-backed labels and responsive navigation surfaces", async ({
  page,
}, testInfo) => {
  // Actual local renderer, no supplier/GPS fixtures and no API calls.
  const dir = process.env.E2E_CAPTURE_DIR
    ? process.env.E2E_CAPTURE_DIR + "/map-feedback"
    : "docs/screenshots/s1/map-feedback";
  await mkdir(dir, { recursive: true });
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  const capture = async (name: string) =>
    page.screenshot({
      path: `${dir}/${testInfo.project.name}-${name}.jpg`,
      type: "jpeg",
    });
  for (const [name, file] of [
    ["教学楼F栋", "teaching-labels"],
    ["羽毛球场", "sports-labels"],
    ["友苑", "dormitory-details"],
    ["下沉隧道", "tunnel-labels"],
  ] as const) {
    await page.getByLabel("搜索校园地点").fill(name);
    await page
      .locator(".place-result")
      .filter({ hasText: name })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await capture(file);
    await page.getByRole("button", { name: "关闭地点详情" }).click();
    await page.getByRole("button", { name: "清空地点搜索" }).click();
    await expect(
      page.getByRole("region", { name: "校园地点搜索结果" }),
    ).toHaveCount(0);
  }
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  await expect(page.getByLabel("导航起点")).toBeVisible();
  await capture("navigation-form");
  await page.getByRole("button", { name: "关闭导航面板" }).click();
  await page.getByRole("button", { name: "打开校园助理" }).click();
  await expect(page.locator(".assistant-panel")).toBeVisible();
  await capture("ai-panel");
});

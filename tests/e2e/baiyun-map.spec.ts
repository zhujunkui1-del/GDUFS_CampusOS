import { test, expect } from "@playwright/test";

test("campus switch opens Baiyun 2D, searches its places and returns to University Town", async ({
  page,
}) => {
  const errors: string[] = [];
  const models: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().endsWith(".glb")) models.push(r.url());
  });
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await page.getByRole("button", { name: "白云山校区", exact: true }).click();
  const map = page.getByTestId("baiyun-map");
  await expect(map).toHaveAttribute("data-status", "ready", { timeout: 30000 });
  await expect(map).toHaveAttribute("data-mode", "2d");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "地图模式，当前2D", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("搜索校园地点", { exact: true }).fill("第二教学楼");
  await page.locator(".place-result").filter({ hasText: "第二教学楼" }).click();
  await expect(page.locator(".place-details-panel")).toContainText(
    "第二教学楼",
  );
  await page.getByRole("button", { name: "关闭地点详情" }).click();
  await page.getByRole("button", { name: "放大地图", exact: true }).click();
  await page.getByRole("button", { name: "地图图层", exact: true }).click();
  await page.getByLabel("宿舍楼栋", { exact: true }).uncheck();
  await expect(
    page.getByRole("button", { name: /查看云山学/ }).first(),
  ).toBeHidden();
  await expect(page.locator(".campus-switcher")).toBeInViewport();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow).toBe(false);
  await page.getByRole("button", { name: "大学城校区", exact: true }).click();
  await expect(page.getByTestId("baiyun-map")).toHaveCount(0);
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "aria-hidden",
    "false",
  );
  await expect(page.getByTestId("map-mode-trigger")).toBeVisible();
  expect(models).toEqual([]);
  expect(errors).toEqual([]);
});

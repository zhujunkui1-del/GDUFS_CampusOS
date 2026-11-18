import { test, expect } from "@playwright/test";
async function ready(page: import("@playwright/test").Page) {
  await page.goto("/map?campus=baiyun");
  await expect(page.getByTestId("baiyun-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
}
test("explicit location reports pending and denied inline without a floating popup", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_success, error) => {
      setTimeout(
        () =>
          error?.({
            code: 1,
            message: "denied",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          }),
        500,
      );
    };
  });
  await ready(page);
  await page
    .getByRole("button", { name: "我的位置作起点", exact: true })
    .click();
  await expect(page.locator(".route-planner .location-feedback")).toHaveText(
    "正在定位…",
  );
  await expect(page.locator(".route-planner .location-feedback")).toHaveText(
    "没有授予定位权限",
  );
  await expect(page.locator(".map-location-notice")).toHaveCount(0);
});
test("Baiyun planning and focused navigation fit portrait and landscape mobile screens", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  for (const [which, name] of [
    ["起点", "第一教学楼"],
    ["终点", "财院操场"],
  ]) {
    await page.getByLabel(`导航${which}`, { exact: true }).fill(name);
    await page
      .getByRole("region", { name: `${which}地点建议` })
      .getByRole("button", { name, exact: true })
      .click();
  }
  await page.getByRole("button", { name: "规划步行路线", exact: true }).click();
  await expect(page.locator(".route-result")).toBeVisible();
  await page.waitForTimeout(900);
  await page.screenshot({ path: info.outputPath("portrait-planning.png") });
  await page.getByRole("button", { name: "开始步行导航", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "步行导航模式" }),
  ).toBeVisible();
  await expect(page.locator(".route-planner")).toHaveCount(0);
  await expect(page.locator(".mobile-navigation")).toBeHidden();
  await expect(page.locator(".baiyun-workspace .map-top")).toBeHidden();
  await page.waitForTimeout(900);
  await page.screenshot({ path: info.outputPath("portrait-navigation.png") });
  for (const size of [
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(900);
    const regions = await page
      .locator(".navigation-direction,.navigation-summary,.navigation-controls")
      .evaluateAll((elements) =>
        elements.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
        }),
      );
    for (const r of regions) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(size.width);
      expect(r.bottom).toBeLessThanOrEqual(size.height);
    }
    await page.screenshot({
      path: info.outputPath(`navigation-${size.width}.png`),
    });
  }
  await page.getByRole("button", { name: "退出步行导航", exact: true }).click();
  await expect(page.getByTestId("baiyun-map")).toHaveAttribute(
    "data-route-points",
    "0",
  );
});

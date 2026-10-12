import { test, expect } from "@playwright/test";
import { mockAMap } from "./map-fixture";

test.beforeEach(async ({ page }) => {
  await mockAMap(page);
});

test("opening another page does not load the map SDK until the map is visited", async ({
  page,
}) => {
  let configRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/map/config")) configRequests++;
  });
  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(configRequests).toBe(0);
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  expect(configRequests).toBeGreaterThan(0);
});
test("map controls, source-backed place details, layers and cross-page state", async ({
  page,
  isMobile,
}) => {
  await page.goto("/map");
  const map = page.getByTestId("campus-map");
  await expect(map).toHaveAttribute("data-status", "ready");
  await expect(map).toHaveAttribute("data-scope", "campus-and-visible-context");
  await page.getByRole("button", { name: "切换为2D", exact: true }).click();
  await expect(map).toHaveAttribute("data-mode", "2d");
  await page.getByRole("button", { name: "生活区", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "生活区", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const beforeZoom = Number(await map.getAttribute("data-zoom"));
  await page.getByRole("button", { name: "放大地图" }).click();
  expect(Number(await map.getAttribute("data-zoom"))).toBeCloseTo(
    Math.min(20, beforeZoom + 1),
    1,
  );
  for (let i = 0; i < 8; i++)
    await page.getByRole("button", { name: "缩小地图" }).click();
  expect(Number(await map.getAttribute("data-zoom"))).toBeCloseTo(
    Number(await map.getAttribute("data-min-zoom")),
    1,
  );
  await page.getByRole("button", { name: "地图图层", exact: true }).click();
  await page.getByLabel("体育设施", { exact: true }).uncheck();
  await expect(page.getByLabel("体育设施", { exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "地图图层", exact: true }).click();
  await page.getByLabel("搜索校园地点").fill("北苑1栋");
  await page.locator(".place-result").filter({ hasText: "北苑1栋" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "北苑1栋", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("建筑入口与开放时间尚未核验。", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  await expect(page.locator(".assistant-map-context")).toContainText("北苑1栋");
  await page.getByRole("button", { name: "收起校园助理" }).click();
  const nav = page.getByRole("navigation", {
    name: isMobile ? "手机主导航" : "桌面主导航",
  });
  await nav
    .getByRole("link", { name: isMobile ? "知识" : "校园知识", exact: true })
    .click();
  await nav
    .getByRole("link", { name: isMobile ? "地图" : "校园地图", exact: true })
    .click();
  await expect(map).toHaveAttribute("data-mode", "2d");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("route selection computes through the SDK and reset discards results", async ({
  page,
  isMobile,
}) => {
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  await page
    .getByRole("button", { name: "在地图上选择起点", exact: true })
    .click();
  await page.mouse.click(isMobile ? 120 : 700, 250);
  await expect(
    page.getByRole("button", { name: /地图选定起点/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "在地图上选择终点", exact: true })
    .click();
  await page.mouse.click(isMobile ? 170 : 740, 310);
  await expect(
    page.getByRole("button", { name: /地图选定终点/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "规划步行路线", exact: true }).click();
  await expect(page.locator(".route-result")).toContainText("90 米");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-mode",
    "2d",
  );
  await page.getByRole("button", { name: "重置路线", exact: true }).click();
  await expect(page.locator(".route-result")).toHaveCount(0);
});

test("missing map credentials and unlisted proxy endpoints report actual failure", async ({
  page,
  request,
}) => {
  await page.route("**/api/map/config", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          configured: false,
          webKey: null,
          securityProxyPath: "/_AMapService",
        },
      },
    }),
  );
  await page.goto("/map");
  await expect(
    page.getByRole("heading", { name: "地图暂时无法加载", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "切换为2D", exact: true }),
  ).toBeDisabled();
  const proxy = await request.get("/_AMapService/not-permitted?key=fixture");
  expect([404, 503]).toContain(proxy.status());
  const places = await request.get("/api/places?q=北苑1栋");
  expect((await places.json()).data.places[0].name).toBe("北苑1栋");
});

import { test, expect } from "@playwright/test";
import { mockAMap } from "./map-fixture";
import type { Page } from "@playwright/test";

async function clickMapGround(
  page: Page,
  preferredX: number,
  preferredY: number,
) {
  const point = await page.evaluate(
    ({ x, y }) => {
      for (const dy of [0, 25, -25, 50])
        for (const dx of [0, 35, -35, 70]) {
          const target = document.elementFromPoint(x + dx, y + dy);
          if (
            target?.closest('[data-testid="campus-map"]') &&
            !target.closest("button")
          )
            return { x: x + dx, y: y + dy };
        }
      throw new Error("No unobscured map ground in the test viewport");
    },
    { x: preferredX, y: preferredY },
  );
  await page.mouse.click(point.x, point.y);
}

test.beforeEach(async ({ page }) => {
  await mockAMap(page);
});

test("opening another page does not load the map SDK until the map is visited", async ({
  page,
}) => {
  let snapshotRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith(".geojson")) snapshotRequests++;
  });
  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(snapshotRequests).toBe(0);
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  expect(snapshotRequests).toBeGreaterThan(0);
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
  await page.getByLabel("搜索校园地点").fill("图书馆");
  await page.locator(".place-result").filter({ hasText: "图书馆" }).click();
  await page.getByRole("button", { name: "关闭地点详情" }).click();
  await page.getByRole("button", { name: "切换为2D", exact: true }).click();
  const library = await page
    .getByRole("button", { name: "查看图书馆", exact: true })
    .boundingBox();
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  await page
    .getByRole("button", { name: "在地图上选择起点", exact: true })
    .click();
  await clickMapGround(
    page,
    library!.x + library!.width / 2 + 35,
    library!.y + library!.height - 60,
  );
  await expect(
    page.getByRole("button", { name: /地图选定起点/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "在地图上选择终点", exact: true })
    .click();
  await clickMapGround(
    page,
    library!.x + library!.width / 2 + 90,
    library!.y + library!.height - 80,
  );
  await expect(
    page.getByRole("button", { name: /地图选定终点/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "规划步行路线", exact: true }).click();
  await expect(page.locator(".route-result")).toContainText("90 米");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-mode",
    "2d",
  );
  if (!isMobile) {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => {
        const raw = await page
          .getByTestId("campus-map")
          .getAttribute("data-route-extent");
        const panel = await page.locator(".route-planner").boundingBox();
        if (!raw || !panel) return false;
        const [left, top, right, bottom] = JSON.parse(raw);
        return left >= 0 && top >= 0 && right <= 390 && bottom < panel.y;
      })
      .toBe(true)
      .catch(async (error) => {
        throw new Error(
          `${error.message}\nroute extent=${await page.getByTestId("campus-map").getAttribute("data-route-extent")} panel=${JSON.stringify(await page.locator(".route-planner").boundingBox())} map=${JSON.stringify(await page.getByTestId("campus-map").boundingBox())}`,
        );
      });
    await expect(page.locator(".route-result")).toContainText("90 米");
  }
  await page.getByRole("button", { name: "重置路线", exact: true }).click();
  await expect(page.locator(".route-result")).toHaveCount(0);
});

test("missing online credentials keeps the local map usable and reports service failure", async ({
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
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await expect(
    page.getByRole("button", { name: "切换为2D", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("搜索校园地点").fill("图书馆");
  await page
    .getByRole("button", { name: "查询高德在线地点", exact: true })
    .click();
  await expect(
    page.getByText("高德查询暂时失败，校园已收录地点仍可搜索。", {
      exact: true,
    }),
  ).toBeVisible();
  const proxy = await request.get("/_AMapService/not-permitted?key=fixture");
  expect([404, 503]).toContain(proxy.status());
  const places = await request.get("/api/places?q=北苑1栋");
  expect((await places.json()).data.places[0].name).toBe("北苑1栋");
});

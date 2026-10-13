import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

async function ready(page: Page) {
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
}
async function choose(page: Page, which: string, name: string) {
  await page.getByLabel("导航" + which).fill(name);
  await page
    .getByRole("region", { name: which + "地点建议" })
    .getByRole("button", { name: new RegExp(name) })
    .first()
    .click();
}
test("tag switches retain real sports surfaces", async ({ page }) => {
  await ready(page);
  await page.getByLabel("搜索校园地点").fill("体育馆");
  await page
    .locator(".place-result")
    .filter({ hasText: "体育馆" })
    .first()
    .click();
  await page.getByRole("button", { name: "关闭地点详情" }).click();
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-camera-moving",
    "false",
  );
  let last = -1;
  await expect
    .poll(async () => {
      const value = Number(
        await page
          .getByTestId("campus-map")
          .getAttribute("data-sports-feature-count"),
      );
      const stable = value > 0 && value === last;
      last = value;
      return stable;
    })
    .toBe(true);
  const count = Number(
    await page
      .getByTestId("campus-map")
      .getAttribute("data-sports-feature-count"),
  );
  expect(count).toBeGreaterThan(0);
  await page.getByRole("button", { name: "地图图层", exact: true }).click();
  await page.getByLabel("体育设施", { exact: true }).uncheck();
  await expect(
    page.locator(".campus-marker.marker-sports:visible"),
  ).toHaveCount(0);
  expect(
    Number(
      await page
        .getByTestId("campus-map")
        .getAttribute("data-sports-feature-count"),
    ),
  ).toBe(count);
});
test("location notice is dismissible and expires instead of sticking", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (
          _success: unknown,
          fail: (e: { code: number }) => void,
        ) => fail({ code: 3 }),
        clearWatch: () => {},
      },
    }),
  );
  await ready(page);
  await page.getByRole("button", { name: "定位我的位置", exact: true }).click();
  await expect(page.locator(".map-location-notice")).toContainText("超时");
  await page.getByRole("button", { name: "关闭定位提示" }).click();
  await expect(page.locator(".map-location-notice")).toHaveCount(0);
  await page.getByRole("button", { name: "定位我的位置", exact: true }).click();
  await expect(page.locator(".map-location-notice")).toBeVisible();
  await expect(page.locator(".map-location-notice")).toHaveCount(0, {
    timeout: 8000,
  });
});
test("map picks hold camera while typed places and routes animate into unobstructed space", async ({
  page,
}) => {
  await ready(page);
  await page.getByLabel("搜索校园地点").fill("图书馆");
  await page
    .locator(".place-result")
    .filter({ hasText: "图书馆" })
    .first()
    .click();
  await page.getByRole("button", { name: "关闭地点详情" }).click();
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-camera-moving",
    "false",
  );
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  const before = await page
    .getByTestId("campus-map")
    .getAttribute("data-ground-corners");
  await page
    .getByRole("button", { name: "在地图上选择起点", exact: true })
    .click();
  await page.getByRole("button", { name: "查看图书馆", exact: true }).click();
  await expect(page.getByLabel("导航起点")).toHaveValue("图书馆");
  expect(
    await page.getByTestId("campus-map").getAttribute("data-ground-corners"),
  ).toBe(before);
  const animations = Number(
    await page
      .getByTestId("campus-map")
      .getAttribute("data-camera-animation-count"),
  );
  await choose(page, "终点", "教学楼G栋");
  await expect
    .poll(async () =>
      Number(
        await page
          .getByTestId("campus-map")
          .getAttribute("data-camera-animation-count"),
      ),
    )
    .toBeGreaterThan(animations);
  expect(
    Number(
      await page
        .getByTestId("campus-map")
        .getAttribute("data-last-camera-duration"),
    ),
  ).toBeGreaterThan(0);
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-camera-moving",
    "false",
  );
  const marker = await page
      .getByRole("button", { name: "查看教学楼G栋", exact: true })
      .boundingBox(),
    panel = await page.locator(".route-planner").boundingBox();
  expect(marker!.y + marker!.height).toBeLessThan(panel!.y);
  await page.getByRole("button", { name: "规划步行路线", exact: true }).click();
  await expect(page.locator(".route-result")).toBeVisible();
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-camera-moving",
    "false",
  );
});
test("full-campus route and focused navigation retain honest GPS failure state", async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition: (_s: unknown, fail: (e: { code: number }) => void) => {
          setTimeout(() => fail({ code: 1 }), 0);
          return 1;
        },
        clearWatch: () => {},
      },
    }),
  );
  await ready(page);
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  await choose(page, "起点", "南苑13栋");
  await choose(page, "终点", "教学楼E栋");
  await page.getByRole("button", { name: "规划步行路线", exact: true }).click();
  await expect(page.locator(".route-result")).toContainText("穿过下沉隧道");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-camera-moving",
    "false",
  );
  const dir = "docs/screenshots/s1/campus-navigation";
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: `${dir}/${info.project.name}-dorm-to-teaching-route.jpg`,
    type: "jpeg",
  });
  await page.getByRole("button", { name: "开始步行导航", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "步行导航模式" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "手机主导航" }),
  ).toBeHidden();
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.getByLabel("搜索校园地点")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "3D建筑尚未就绪" }),
  ).toBeDisabled();
  await expect(page.locator(".navigation-location-status")).toContainText(
    "权限未获允许",
  );
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-camera-moving",
    "false",
  );
  await expect
    .poll(async () => {
      const raw = await page
          .getByTestId("campus-map")
          .getAttribute("data-route-extent"),
        top = await page.locator(".navigation-direction").boundingBox(),
        bottom = await page.locator(".navigation-summary").boundingBox();
      if (!raw || !top || !bottom) return false;
      const r = JSON.parse(raw);
      return r[1] >= top.y + top.height + 12 && r[3] <= bottom.y - 12;
    })
    .toBe(true);
  await page.screenshot({
    path: `${dir}/${info.project.name}-navigation-gps-denied.jpg`,
    type: "jpeg",
  });
  await writeFile(
    `${dir}/${info.project.name}-conditions.json`,
    JSON.stringify(
      {
        route: "actual local OSM / owner-reviewed campus policy",
        routeMock: false,
        gps: "controlled permission denial; no real personal location",
      },
      null,
      2,
    ) + "\n",
  );
  await page.getByRole("button", { name: "切换路线方向朝上" }).click();
  await expect(page.getByRole("button", { name: "切换朝北" })).toBeVisible();
  await page.getByRole("button", { name: "退出步行导航" }).click();
  await expect(page.locator(".route-result")).toBeVisible();
  await expect(page.getByLabel("导航终点")).toHaveValue("教学楼E栋");
});
test("capture owner-reviewed parking, bridges and octagonal building", async ({
  page,
}, info) => {
  await ready(page);
  const dir = "docs/screenshots/s1/campus-navigation";
  await mkdir(dir, { recursive: true });
  for (const [name, file] of [
    ["体育馆北侧停车场", "parking"],
    ["语心桥（教学楼F栋）", "bridges"],
    ["八角楼", "octagonal-building"],
  ] as const) {
    await page.getByLabel("搜索校园地点").fill(name);
    await page
      .locator(".place-result")
      .filter({ hasText: name })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByTestId("campus-map")).toHaveAttribute(
      "data-camera-moving",
      "false",
    );
    await page.screenshot({
      path: `${dir}/${info.project.name}-${file}.jpg`,
      type: "jpeg",
    });
    await page.getByRole("button", { name: "关闭地点详情" }).click();
    await page.getByRole("button", { name: "清空地点搜索" }).click();
  }
});
test("controlled GPS updates progress and view orientation without external requests", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    longitude: 113.3912426,
    latitude: 23.0635083,
    accuracy: 10,
  });
  await ready(page);
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  await choose(page, "起点", "下沉隧道生活区入口");
  await choose(page, "终点", "下沉隧道教学区入口");
  await page.getByRole("button", { name: "规划步行路线", exact: true }).click();
  await expect(page.locator(".route-result")).toBeVisible();
  await page.getByRole("button", { name: "开始步行导航", exact: true }).click();
  await expect(page.locator(".navigation-direction")).toContainText(
    "正在更新步行位置",
  );
  const before = Number(
    (
      await page.locator(".navigation-metrics strong").first().innerText()
    ).match(/\d+/)![0],
  );
  expect(before).toBeGreaterThan(100);
  await context.setGeolocation({
    longitude: 113.392672,
    latitude: 23.0650147,
    accuracy: 10,
  });
  await expect
    .poll(async () =>
      Number(
        (
          await page.locator(".navigation-metrics strong").first().innerText()
        ).match(/\d+/)![0],
      ),
    )
    .toBeLessThan(15);
  await page.getByRole("button", { name: "切换路线方向朝上" }).click();
  await expect(page.getByRole("button", { name: "切换朝北" })).toBeVisible();
  await page.getByRole("button", { name: "退出步行导航" }).click();
  await expect(page.getByLabel("导航起点")).toHaveValue("下沉隧道生活区入口");
});

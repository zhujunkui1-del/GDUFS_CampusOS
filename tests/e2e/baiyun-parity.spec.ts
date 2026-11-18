import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const baiyun: { places: Array<{ name: string; coordinate: number[] }> } =
  JSON.parse(
    readFileSync("src/features/campus-map/data/baiyun-map.json", "utf8"),
  );

test("Baiyun keeps the signed-in avatar, feedback, traffic and the shared details drawer", async ({
  page,
  isMobile,
}) => {
  await page.setViewportSize({ width: isMobile ? 515 : 1078, height: 871 });
  await page.route("**/api/auth/session", (r) =>
    r.fulfill({
      json: {
        ok: true,
        data: {
          available: true,
          mailAvailable: false,
          user: { id: "fixture-avatar", username: "Avatar", email: null },
        },
      },
    }),
  );
  await page.route("**/api/public/building?**", (r) =>
    r.fulfill({
      json: { ok: true, data: { description: "隔离测试建筑简介", photos: [] } },
    }),
  );
  await page.route("**/api/public/activities?**", (r) =>
    r.fulfill({
      json: {
        ok: true,
        data: { items: [], total: 0, hasMore: false, nextCursor: null },
      },
    }),
  );
  await page.goto("/map");
  const avatar = page.locator(".map-account-avatar");
  await expect(avatar).toHaveText("A");
  await page.getByRole("button", { name: "白云山校区", exact: true }).click();
  await expect(page.getByTestId("baiyun-map")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 30000 },
  );
  await expect(avatar).toHaveText("A");
  const feedback = page.getByRole("button", { name: "留言区", exact: true }),
    traffic = page.getByRole("button", { name: "访问量", exact: true });
  await expect(feedback).toBeVisible();
  await expect(traffic).toBeVisible();
  const search = await page.locator(".map-search").boundingBox(),
    button = await feedback.boundingBox();
  expect(search!.x + search!.width).toBeLessThanOrEqual(button!.x);
  await feedback.click();
  await expect(
    page.getByPlaceholder(
      "写下你的问题、建议或想补充的官网、公众号、图片。补充官网、公众号时，请附名称和一篇推文链接。",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭留言区" }).click();
  await traffic.click();
  await expect(page.getByRole("dialog", { name: "网站访问量" })).toBeVisible();
  await page.getByRole("button", { name: "关闭访问量" }).click();
  await page.getByLabel("搜索校园地点", { exact: true }).fill("第二教学楼");
  await page.locator(".place-result").filter({ hasText: "第二教学楼" }).click();
  const detail = page.locator(".place-details-panel");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("隔离测试建筑简介");
  await expect(detail).toContainText("暂无图片");
  await expect(detail).toContainText("暂无活动");
  await detail.getByRole("button", { name: "选择导航终点" }).click();
  await expect(
    page.getByRole("complementary", { name: "校园步行路线" }),
  ).toBeVisible();
  await expect(page.getByLabel("导航终点", { exact: true })).toHaveValue(
    "第二教学楼",
  );
});

test("Baiyun navigation plans a real campus route and closing removes it", async ({
  page,
  context,
}) => {
  const library = baiyun.places.find((p) => p.name === "北校区图书馆")!;
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    longitude: library.coordinate[0],
    latitude: library.coordinate[1],
    accuracy: 5,
  });
  await page.addInitScript(() => {
    const geolocation = navigator.geolocation,
      watch = geolocation.watchPosition.bind(geolocation),
      clear = geolocation.clearWatch.bind(geolocation);
    const active = new Set<number>();
    Object.defineProperty(window, "activeNavigationWatches", {
      get: () => active.size,
    });
    geolocation.watchPosition = (...args) => {
      const id = watch(...args);
      active.add(id);
      return id;
    };
    geolocation.clearWatch = (id) => {
      active.delete(id);
      clear(id);
    };
  });
  await page.goto("/map");
  await page.getByRole("button", { name: "白云山校区", exact: true }).click();
  await expect(page.getByTestId("baiyun-map")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 30000 },
  );
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  await page.getByLabel("导航起点", { exact: true }).fill("北校区图书馆");
  await page
    .getByRole("region", { name: "起点地点建议" })
    .getByRole("button", { name: "北校区图书馆", exact: true })
    .click();
  await page.getByLabel("导航终点", { exact: true }).fill("第二教学楼");
  await page
    .getByRole("region", { name: "终点地点建议" })
    .getByRole("button", { name: "第二教学楼", exact: true })
    .click();
  await page.getByRole("button", { name: "规划步行路线", exact: true }).click();
  await expect(
    page.locator('.route-result[data-route-source="baiyun-osm"]'),
  ).toBeVisible();
  await expect(page.getByTestId("baiyun-map")).toHaveAttribute(
    "data-route-source",
    "baiyun-osm",
  );
  expect(
    Number(
      await page.getByTestId("baiyun-map").getAttribute("data-route-points"),
    ),
  ).toBeGreaterThan(2);
  await page.getByRole("button", { name: "开始步行导航", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "退出步行导航", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "activeNavigationWatches")),
    )
    .toBe(0);
  await page.getByRole("button", { name: "退出步行导航", exact: true }).click();
  await expect(page.getByTestId("baiyun-map")).toHaveAttribute(
    "data-route-points",
    "0",
  );
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "activeNavigationWatches")),
    )
    .toBe(0);
});

test("building administration switches campus and saves the selected Baiyun profile", async ({
  page,
}) => {
  await page.route("**/api/console-auth", (r) =>
    r.fulfill({
      json: {
        ok: true,
        data: {
          authenticated: true,
          mode: "local",
          environment: "local",
          csrf: "fixture-csrf",
          actor: {
            id: "fixture-admin",
            email: "admin@example.invalid",
            role: "admin",
          },
        },
      },
    }),
  );
  const items = [
    {
      id: "osm-way-307250998",
      name: "图书馆",
      campus: "university",
      description: "大学城简介",
      photos: [],
    },
    {
      id: "osm-relation-13030162",
      name: "第二教学楼",
      campus: "baiyun",
      description: "",
      photos: [],
    },
  ];
  const writes: string[] = [];
  await page.route(
    /\/api\/admin\/v2\/buildings(?:\/[^?]+)?(?:\?.*)?$/,
    async (r) => {
      if (r.request().method() === "POST") {
        const id = new URL(r.request().url()).pathname.split("/").at(-1)!;
        writes.push(id);
        Object.assign(
          items.find((p) => p.id === id)!,
          r.request().postDataJSON(),
        );
        await r.fulfill({ json: { ok: true, data: { saved: true } } });
      } else await r.fulfill({ json: { ok: true, data: { items } } });
    },
  );
  await page.goto("/admin/buildings");
  await expect(
    page.getByRole("combobox", { name: "建筑", exact: true }),
  ).toContainText("图书馆");
  await page
    .getByRole("group", { name: "建筑校区" })
    .getByRole("button", { name: "白云山校区", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "建筑", exact: true }),
  ).toHaveValue("osm-relation-13030162");
  await expect(
    page.getByRole("combobox", { name: "建筑", exact: true }),
  ).not.toContainText("图书馆");
  await page
    .getByRole("textbox", { name: "简介", exact: true })
    .fill("白云山保存验收");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("已保存");
  expect(writes).toEqual(["osm-relation-13030162"]);
  await page
    .getByRole("group", { name: "建筑校区" })
    .getByRole("button", { name: "大学城校区", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "简介", exact: true }),
  ).toHaveValue("大学城简介");
});

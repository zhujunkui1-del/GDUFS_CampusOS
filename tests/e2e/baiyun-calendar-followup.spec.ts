import { test, expect } from "@playwright/test";

test("University Town named endpoints also start without geolocation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let count = 0;
    Object.defineProperty(window, "positionRequests", { get: () => count });
    navigator.geolocation.getCurrentPosition = () => {
      count++;
    };
    navigator.geolocation.watchPosition = () => {
      count++;
      return 1;
    };
  });
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  for (const [which, name] of [
    ["起点", "北苑1栋"],
    ["终点", "南苑7栋"],
  ]) {
    await page.getByLabel(`导航${which}`, { exact: true }).fill(name);
    await page
      .getByRole("region", { name: `${which}地点建议` })
      .getByRole("button", { name: new RegExp(name) })
      .click();
  }
  await page.getByRole("button", { name: "规划步行路线", exact: true }).click();
  await expect(page.locator(".route-result")).toBeVisible();
  await page.getByRole("button", { name: "开始步行导航", exact: true }).click();
  expect(
    await page.evaluate(() => Reflect.get(window, "positionRequests")),
  ).toBe(0);
});
test("denied location does not display a failure notice in either campus", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const failure = (error: PositionErrorCallback | null | undefined) =>
      queueMicrotask(() =>
        error?.({
          code: 1,
          message: "denied",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        }),
      );
    navigator.geolocation.getCurrentPosition = (_success, error) =>
      failure(error);
    navigator.geolocation.watchPosition = (_success, error) => {
      failure(error);
      return 1;
    };
  });
  await page.goto("/map");
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await page.getByRole("button", { name: "定位我的位置", exact: true }).click();
  await expect(page.getByText(/定位权限未获|定位失败|请允许定位/)).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "白云山校区", exact: true }).click();
  await expect(page.getByTestId("baiyun-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await page.getByRole("button", { name: "定位我的位置", exact: true }).click();
  await expect(page.getByText(/定位权限未获|定位失败|请允许定位/)).toHaveCount(
    0,
  );
});
test("named Baiyun navigation includes map picking and never requests device position", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let count = 0;
    Object.defineProperty(window, "positionRequests", { get: () => count });
    const g = navigator.geolocation;
    g.getCurrentPosition = () => {
      count++;
    };
    g.watchPosition = () => {
      count++;
      return 1;
    };
  });
  await page.goto("/map");
  await page.getByRole("button", { name: "白云山校区", exact: true }).click();
  await expect(page.getByTestId("baiyun-map")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await page.getByRole("button", { name: "校园步行导航", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "在地图上选择起点", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "在地图上选择终点", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "在地图上选择起点", exact: true })
    .click();
  await expect(page.locator(".map-pick-notice")).toHaveCount(0);
  const target = await page.evaluate(() => {
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      ".baiyun-map-canvas .campus-marker:not([hidden])",
    )) {
      const r = button.getBoundingClientRect(),
        at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (at === button || button.contains(at))
        return {
          label: button.getAttribute("aria-label")!,
          name: button.textContent!,
        };
    }
    throw Error("No unobstructed campus building");
  });
  await page.getByRole("button", { name: target.label, exact: true }).click();
  await expect(page.getByLabel("导航起点", { exact: true })).toHaveValue(
    target.name,
  );
  await page.getByLabel("导航起点", { exact: true }).fill("第一教学楼");
  await page
    .getByRole("region", { name: "起点地点建议" })
    .getByRole("button", { name: "第一教学楼", exact: true })
    .click();
  await page.getByLabel("导航终点", { exact: true }).fill("第七教学楼");
  await page
    .getByRole("region", { name: "终点地点建议" })
    .getByRole("button", { name: "第七教学楼", exact: true })
    .click();
  await page.getByRole("button", { name: "规划步行路线", exact: true }).click();
  await expect(page.locator(".route-result")).toBeVisible();
  await page.getByRole("button", { name: "开始步行导航", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "退出步行导航", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => Reflect.get(window, "positionRequests")),
  ).toBe(0);
  await expect(
    page.getByText("定位失败，请检查位置权限。", { exact: true }),
  ).toHaveCount(0);
});
test("calendar links open the matching Baiyun building", async ({ page }) => {
  await page.goto("/map?campus=baiyun&place=osm-way-338028591");
  await expect(page.getByTestId("baiyun-map")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 30000 },
  );
  await expect(page.locator(".place-details-heading")).toContainText(
    "第一教学楼",
  );
  await page.evaluate(() =>
    window.history.pushState(
      null,
      "",
      "/map?campus=baiyun&place=osm-relation-13030162",
    ),
  );
  await expect(page.locator(".place-details-heading")).toContainText(
    "第二教学楼",
  );
});
for (const surface of ["radar", "knowledge"] as const)
  test(`${surface} cards open the existing task editor below the favorite`, async ({
    page,
  }) => {
    const category = surface === "radar" ? "lecture" : "academic_affairs";
    const item = {
      id: "fixture-feed-task",
      version: 1,
      title: "待办入口隔离验收",
      url: "https://example.invalid/task",
      publishedAt: "2026-11-18",
      contentType: "notice",
      source: { name: "隔离测试", official: true },
      radarCategory: surface === "radar" ? category : null,
      knowledgeCategory: surface === "knowledge" ? category : null,
    };
    await page.route("**/api/auth/session", (r) =>
      r.fulfill({
        json: {
          ok: true,
          data: {
            available: true,
            mailAvailable: false,
            user: { id: "fixture-user", username: "TaskUser" },
          },
        },
      }),
    );
    await page.route("**/api/public/content?**", (r) =>
      r.fulfill({
        json: {
          ok: true,
          data: {
            items: [item],
            groups: { [category]: [item] },
            counts: { [category]: 1 },
            total: 1,
            hasMore: false,
            nextCursor: null,
          },
        },
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
    await page.goto("/" + surface);
    const card = page
        .locator(".public-feed-card")
        .filter({ hasText: item.title })
        .first(),
      button = card.getByRole("button", { name: "添加待办", exact: true });
    await expect(button).toBeVisible();
    const task = await button.boundingBox(),
      favorite = await card
        .locator(".favorite-button:not(.task-add-button)")
        .boundingBox();
    expect(task!.y).toBeGreaterThan(favorite!.y);
    await button.click();
    await expect(
      page.getByRole("dialog", { name: "新建待办", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "标题", exact: true }),
    ).toHaveValue(item.title);
    await page.getByRole("button", { name: "取消", exact: true }).click();
  });

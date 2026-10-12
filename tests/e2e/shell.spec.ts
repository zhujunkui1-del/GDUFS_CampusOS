import { test, expect } from "@playwright/test";

test("visitor shell, shared assistant and honest unavailable states", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/map$/);
  await expect(
    page.getByRole("heading", { name: "校园地图准备中" }),
  ).toBeVisible();
  await expect(page.getByLabel("搜索校园地点")).toBeDisabled();
  await page.getByRole("button", { name: "打开校园助理" }).click();
  await expect(
    page.getByRole("heading", { name: "校园助理暂不可用" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "发送消息" })).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("map-assistant.png"),
    fullPage: true,
  });
  const nav = page.getByRole("navigation", {
    name: isMobile ? "手机主导航" : "桌面主导航",
  });
  await nav
    .getByRole("link", { name: isMobile ? "知识" : "校园知识", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "知识来源尚未接入" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "校园助理暂不可用" }),
  ).toBeVisible();
  if (isMobile) {
    await page.getByRole("button", { name: "展开全屏助理" }).click();
    await expect(page.locator("#campus-assistant")).toHaveClass(/drawer-full/);
    await page.getByRole("button", { name: "恢复半屏助理" }).click();
    const halfHeight = Math.min(
      (page.viewportSize()?.height ?? 844) * 0.54,
      510,
    );
    await expect
      .poll(
        async () =>
          (await page.locator("#campus-assistant").boundingBox())?.height,
      )
      .toBeCloseTo(halfHeight, 0);
    const handle = await page
      .getByRole("button", { name: "展开全屏助理" })
      .boundingBox();
    if (!handle) throw new Error("Drawer handle is not visible");
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y - 90, {
      steps: 5,
    });
    await page.mouse.up();
    await expect(page.locator("#campus-assistant")).toHaveClass(/drawer-full/);
  }
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "校园助理暂不可用" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开校园助理" }),
  ).toBeFocused();
  await nav.getByRole("link", { name: "我的账号", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "账号服务正在接入" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("API never trusts an incoming user identity or pretends integrations are ready", async ({
  request,
}) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect((await health.json()).data.status).toBe("ok");
  const me = await request.get("/api/me?userId=admin", {
    headers: { Cookie: "userId=admin", "X-User-Id": "admin" },
  });
  expect(me.status()).toBe(401);
  expect((await me.json()).error.code).toBe("UNAUTHORIZED");
  const capabilities = await request.get("/api/capabilities");
  const body = await capabilities.json();
  expect(
    Object.values(body.data.capabilities).every(
      (item) => !(item as { available: boolean }).available,
    ),
  ).toBe(true);
});

test("all documented page routes and missing pages render", async ({
  page,
}) => {
  for (const route of ["radar", "schedule", "favorites", "account"]) {
    await page.goto(`/${route}`);
    await expect(page.locator("main h1")).toBeVisible();
  }
  await page.goto("/missing-page");
  await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
});

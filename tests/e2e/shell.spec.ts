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
  await expect(page.locator(".topbar")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("button", { name: "打开校园助理" }).click();
  await expect(
    page.getByRole("heading", { name: "服务尚未接入" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "发送消息" })).toBeDisabled();
  await expect(page.locator("#campus-assistant")).toHaveCSS("opacity", "1");
  if (isMobile) {
    await expect
      .poll(async () =>
        page
          .locator("#campus-assistant")
          .evaluate(
            (element) =>
              parseFloat(
                getComputedStyle(element).getPropertyValue(
                  "--drawer-snap-point-offset",
                ),
              ) || 0,
          ),
      )
      .toBeGreaterThan(100);
    await expect
      .poll(async () =>
        page.locator("#campus-assistant").evaluate((element) => {
          const style = getComputedStyle(element);
          const offset =
            parseFloat(style.getPropertyValue("--drawer-snap-point-offset")) ||
            0;
          return Math.abs(new DOMMatrix(style.transform).m42 - offset);
        }),
      )
      .toBeLessThan(0.5);
  }
  if (isMobile) {
    await expect
      .poll(
        async () => (await page.locator("#campus-assistant").boundingBox())?.y,
      )
      .toBeGreaterThan(150);
    const composer = await page.locator(".assistant-composer").boundingBox();
    const tabs = await page
      .getByRole("navigation", { name: "手机主导航" })
      .boundingBox();
    if (!composer || !tabs) throw new Error("Composer or navigation missing");
    expect(composer.y + composer.height).toBeLessThanOrEqual(tabs.y);
    await expect(page.getByLabel("向校园助理提问")).toBeInViewport();
  }
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
    page.getByRole("heading", { name: "服务尚未接入" }),
  ).toBeVisible();
  if (isMobile) {
    await page.getByRole("button", { name: "展开全屏助理" }).click();
    await expect(page.locator("#campus-assistant")).toHaveClass(/drawer-full/);
    await page.getByRole("button", { name: "恢复半屏助理" }).click();
    const panel = page.locator("#campus-assistant");
    await expect
      .poll(async () =>
        panel.evaluate((element) => {
          const style = getComputedStyle(element);
          const offset =
            parseFloat(style.getPropertyValue("--drawer-snap-point-offset")) ||
            0;
          return Math.abs(new DOMMatrix(style.transform).m42 - offset);
        }),
      )
      .toBeLessThan(0.5);
    const handle = await page.getByTestId("drawer-grabber").boundingBox();
    const before = await panel.boundingBox();
    if (!handle || !before) throw new Error("Drawer handle is not visible");
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y - 90, {
      steps: 5,
    });
    await expect
      .poll(async () => (await panel.boundingBox())?.y)
      .toBeLessThan(before.y - 40);
    await page.mouse.up();
    await expect(panel).toHaveClass(/drawer-full/);
  }
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "服务尚未接入" }),
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

test("layout, larger text, accessibility preferences and keyboard interaction", async ({
  page,
  isMobile,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/map");
  await page.evaluate(() => document.fonts.ready);
  if (!isMobile) {
    await page.getByRole("button", { name: "展开导航" }).click();
    await expect(page.locator(".brand-word")).toBeVisible();
    await page.getByRole("button", { name: "收起导航" }).click();
  }
  await expect(page.locator(".compact-brand")).toBeVisible();
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const heading = await page.locator("#map-title").boundingBox();
  const search = await page.locator(".map-search").boundingBox();
  if (!heading || !search) throw new Error("Map landmarks are missing");
  expect(heading.y).toBeGreaterThan(search.y + search.height);
  await page.screenshot({
    path: testInfo.outputPath("large-text.png"),
    fullPage: true,
  });
  await page.goto("/map");
  await page.emulateMedia({ reducedMotion: "reduce", contrast: "more" });
  await expect(page.locator(".map-search")).toHaveCSS(
    "backdrop-filter",
    "none",
  );
  await page.getByRole("button", { name: "打开校园助理" }).focus();
  await page.getByRole("button", { name: "打开校园助理" }).press("Enter");
  await expect(page.locator("#campus-assistant")).toHaveAttribute(
    "data-instant",
    "",
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "打开校园助理" }),
  ).toBeFocused();
  expect(errors).toEqual([]);
  if (isMobile) {
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(
      page.getByRole("navigation", { name: "手机主导航" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "打开校园助理" }).click();
    await expect(page.locator("#campus-assistant")).toHaveClass(/drawer-full/);
    await expect(
      page.getByRole("button", { name: "收起校园助理" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "收起校园助理" }).click();
  }
});

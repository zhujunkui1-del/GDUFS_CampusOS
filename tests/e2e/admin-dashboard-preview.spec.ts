import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { previewConsoleCredential } from "./helpers/console-credential";
test.skip(
  process.env.DASHBOARD_PREVIEW_E2E !== "1",
  "Explicit Preview dashboard acceptance",
);
test.use({ trace: "off" });
test.setTimeout(120000);
const dir = "docs/verification/admin-dashboard";
test("real traffic, persistent source session, admin protection and responsive dashboard", async ({
  page,
  request,
}, info) => {
  expect(process.env.E2E_BASE_URL).toBe(
    "https://campusos-preview.zhujunkui1.workers.dev",
  );
  mkdirSync(dir, { recursive: true });
  for (const route of ["traffic", "source-session"])
    expect([401, 403]).toContain(
      (await request.get("/api/admin/v2/" + route)).status(),
    );
  const values = JSON.parse(
    readFileSync(".map-tools/s3-a/preview-secrets.json", "utf8"),
  );
  await page.goto("/admin");
  await page
    .getByLabel("管理员访问密钥", { exact: true })
    .fill(previewConsoleCredential(values));
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "访问量", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".console-session-state")).toHaveText("已登录", {
    timeout: 45000,
  });
  await expect(page.locator(".console-traffic-metrics article")).toHaveCount(4);
  await expect(page.locator(".console-traffic-chart li")).toHaveCount(7);
  await page.getByRole("button", { name: "30天", exact: true }).click();
  await expect(page.locator(".console-traffic-chart li")).toHaveCount(30);
  await page.getByRole("button", { name: "7天", exact: true }).click();
  expect(
    await page
      .locator(".console-traffic-chart")
      .evaluate((e) => e.scrollWidth - e.clientWidth),
  ).toBeLessThanOrEqual(2);
  const boxes = await page
    .locator(".console-traffic,.console-v2-metrics,.console-source-session")
    .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().top));
  expect(boxes[0]).toBeLessThan(boxes[1]);
  expect(boxes[1]).toBeLessThan(boxes[2]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const auth = (await (await page.request.get("/api/console-auth")).json())
    .data;
  expect(
    (
      await page.request.post("/api/admin/v2/source-session", {
        data: { kind: "session_control", action: "login" },
      })
    ).status(),
  ).toBe(403);
  const login = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/v2/source-session") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "重新登录", exact: true }).click();
  const loginResponse = await login,
    live = (await loginResponse.json()).data;
  expect(live.state).toBe("logged_in");
  expect(live.qr).toBeNull();
  await page.screenshot({
    path: `${dir}/${info.project.name}-${process.env.PLAYWRIGHT_CHANNEL}-live.png`,
    fullPage: true,
  });
  const before = (
    await (await page.request.get("/api/admin/v2/traffic")).json()
  ).data;
  const front = await page.context().newPage();
  let receipt: { id: string; views: number } | undefined, usage: unknown;
  for (const route of ["/map", "/radar"]) {
    const recorded = front.waitForResponse(
      (r) =>
        r.url().endsWith("/api/public/visits") &&
        r.request().method() === "POST",
    );
    await front.goto(route, { waitUntil: "domcontentloaded" });
    const r = await recorded;
    expect(r.ok()).toBe(true);
    receipt = r.request().postDataJSON();
    // Chromium keepalive responses can omit the CDP loadingFinished event.
    // Verify persistence through the authenticated summary and an idempotent replay.
    usage = { request: r.request().timing(), bodyReadViaCdp: false };
  }
  await front.close();
  const replay = await page.request.post("/api/public/visits", {
    data: receipt,
    headers: { Origin: process.env.E2E_BASE_URL! },
  });
  expect((await replay.json()).data.usage.rowsWritten).toBe(0);
  const after = (await (await page.request.get("/api/admin/v2/traffic")).json())
    .data;
  expect(after.total).toBeGreaterThanOrEqual(before.total + 2);
  expect(
    after.days.filter((d: { views: number | null }) => d.views === null).length,
  ).toBeGreaterThan(0);
  const refreshed = page.waitForResponse((r) =>
    r.url().endsWith("/api/admin/v2/traffic"),
  );
  await page.getByRole("button", { name: "刷新访问量", exact: true }).click();
  const shown = (await (await refreshed).json()).data;
  await expect(
    page.locator(".console-traffic-metrics article").last().locator("strong"),
  ).toHaveText(shown.total.toLocaleString("zh-CN"));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `${dir}/${info.project.name}-${process.env.PLAYWRIGHT_CHANNEL}-live.png`,
    fullPage: true,
  });
  writeFileSync(
    `${dir}/${info.project.name}-${process.env.PLAYWRIGHT_CHANNEL}-live.json`,
    JSON.stringify(
      {
        before,
        after,
        source: {
          state: live.state,
          checkedAt: live.checkedAt,
          usage: live.usage,
        },
        visitWriteUsage: usage,
        unauthorizedRejected: true,
        csrfRejected: true,
        qrNotRequestedForValidSession: true,
      },
      null,
      2,
    ),
  );
  // Isolated UI fixture only. Do not log out a real account to exercise QR rendering.
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  await page.route("**/api/admin/v2/source-session", async (route) => {
    const body =
      route.request().method() === "POST" ? route.request().postDataJSON() : {};
    await route.fulfill({
      json: {
        ok: true,
        data: {
          state: "login_required",
          checkedAt: Date.now(),
          qr: body.action === "login" ? png : null,
          qrExpiresAt: Date.now() + 10000,
        },
      },
    });
  });
  await page.getByRole("button", { name: "重新登录", exact: true }).click();
  await expect(page.getByAltText("小红书登录二维码")).toBeVisible();
  await expect(page.getByText("用小红书 App 扫码并在手机确认")).toBeVisible();
  await page.route("**/api/admin/v2/source-session", async (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          state: "logged_in",
          checkedAt: Date.now(),
          qr: null,
          qrExpiresAt: null,
        },
      },
    }),
  );
  await expect(page.locator(".console-session-state")).toHaveText("已登录", {
    timeout: 10000,
  });
  await expect(page.getByAltText("小红书登录二维码")).toHaveCount(0);
  void auth;
});

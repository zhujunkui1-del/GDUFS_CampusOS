import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { previewConsoleCredential } from "./helpers/console-credential";
test.skip(
  process.env.CONSOLE_V2_PREVIEW !== "1",
  "Explicit read-only deployed preview acceptance",
);
test.use({ trace: "off" });
test("deployed V2 five-page console, permissions, retained withdrawal and responsive layout (read only)", async ({
  page,
  request,
}, info) => {
  expect(process.env.E2E_BASE_URL).toBe(
    "https://campusos-preview.zhujunkui1.workers.dev",
  );
  const anonymous = await request.get("/api/admin/v2/overview");
  expect([401, 403]).toContain(anonymous.status());
  await page.goto("/admin");
  const values = JSON.parse(
    readFileSync(".map-tools/s3-a/preview-secrets.json", "utf8"),
  );
  await page
    .getByLabel("管理员访问密钥", { exact: true })
    .fill(previewConsoleCredential(values));
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "内容运营总览", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "后台导航" }).getByRole("link"),
  ).toHaveText(["总览", "信息源", "内容审核", "过时信息清理", "白名单"]);
  const dir = "docs/verification/console-v2/e/cloud-browser";
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-overview.png`,
    fullPage: true,
  });
  const sources = (
    await (await page.request.get("/api/admin/v2/sources?limit=2")).json()
  ).data;
  expect(sources.total).toBeGreaterThanOrEqual(220);
  expect(sources.items.length).toBe(2);
  const overview = (
    await (await page.request.get("/api/admin/v2/overview")).json()
  ).data;
  const enabled = (
    await (
      await page.request.get("/api/admin/v2/sources?state=enabled&limit=1")
    ).json()
  ).data;
  expect(overview.stats.enabled).toBe(enabled.total);
  await expect(page.locator("main > .console-v2-filters")).toHaveCount(0);
  await expect(page.getByText("执行器授权", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("最近运行与采集任务", { exact: true }),
  ).toHaveCount(0);
  const articles = (
    await (await page.request.get("/api/admin/v2/articles?limit=5")).json()
  ).data;
  for (const article of articles.items) {
    if (article.publication_status !== "withdrawn") continue;
    expect(
      (await request.get("/api/public/content?id=" + article.id)).status(),
    ).toBe(404);
  }
  const publicList = (await (await request.get("/api/public/content")).json())
    .data;
  expect(Array.isArray(publicList.items)).toBe(true);
  await page.getByRole("link", { name: "信息源", exact: true }).first().click();
  await expect(
    page.getByRole("heading", { name: "信息源", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".console-v2-source").first()).toBeVisible();
  for (const q of ["广外", "4"]) {
    const result = (
      await (
        await page.request.get(
          "/api/admin/v2/sources?limit=50&q=" + encodeURIComponent(q),
        )
      ).json()
    ).data;
    expect(
      result.items.every((s: { displayName: string }) =>
        s.displayName.includes(q),
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-sources.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "内容审核", exact: true }).click();
  await expect(
    page.getByText("暂无待处理异常。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "白名单", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "白名单", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "白名单状态", exact: true }),
  ).toHaveCount(0);
  await page.getByText("加入白名单", { exact: true }).first().click();
  await expect(
    page.getByLabel("搜索并选择对象", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".console-target-option").first()).toBeVisible();
  await expect(
    page
      .locator(".console-whitelist-row, section.console-card .console-empty")
      .first(),
  ).toBeVisible();
  await expect(page.getByLabel("保护原因", { exact: true })).toHaveCount(0);
  await expect(
    page.getByLabel("截止时间（北京时间，留空为永久）", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("main h1")).toHaveCSS("font-weight", "600");
  const box = page
    .locator(".console-whitelist-row input[type=checkbox]")
    .first();
  if (await box.count()) {
    const bounds = await box.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(20);
    expect(bounds!.height).toBeLessThanOrEqual(20);
  }
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-whitelist.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "过时信息清理", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "过时信息清理", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("确认新门禁仅约束后续导入，不删除现有内容"),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-retention.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "安全退出", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/admin/v2/whitelist")).status()).toBe(
    401,
  );
});

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
  const dir = "docs/verification/console-v2/d/cloud-browser";
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-overview.png`,
    fullPage: true,
  });
  const sources = (
    await (await page.request.get("/api/admin/v2/sources?limit=2")).json()
  ).data;
  expect(sources.total).toBe(220);
  expect(sources.items.length).toBe(2);
  const articles = (
    await (await page.request.get("/api/admin/v2/articles?limit=5")).json()
  ).data;
  expect(articles.total).toBe(3);
  for (const article of articles.items) {
    expect(article.publication_status).toBe("withdrawn");
    expect(
      (await request.get("/api/public/content?id=" + article.id)).status(),
    ).toBe(404);
  }
  const publicList = (await (await request.get("/api/public/content")).json())
    .data;
  expect(publicList.items).toEqual([]);
  await page.getByRole("link", { name: "信息源", exact: true }).first().click();
  await expect(
    page.getByRole("heading", { name: "信息源", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".console-v2-source").first()).toBeVisible();
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-sources.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "内容审核", exact: true }).click();
  await expect(
    page.getByText("暂无待处理异常。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "白名单", exact: true }).click();
  await expect(page.getByText("暂无记录", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "过时信息清理", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "过时信息清理", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("暂无清理记录", { exact: true })).toBeVisible();
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

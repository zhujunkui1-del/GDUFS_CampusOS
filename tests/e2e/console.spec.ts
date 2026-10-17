import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

// Real local Worker + isolated D1. Never seed test articles into a cloud DB.
test.skip(
  process.env.CONSOLE_LOCAL_E2E !== "1",
  "Requires the dedicated Console local Worker",
);
test.setTimeout(90000);

test("anonymous and forged student identity cannot access management", async ({
  request,
}) => {
  for (const path of [
    "overview",
    "sources",
    "content",
    "jobs",
    "audit",
    "admins",
  ]) {
    const result = await request.get("/api/admin/" + path, {
      headers: {
        "X-User-Role": "admin",
        "X-User-Id": "test",
        Cookie: "campusos_guest=forged",
      },
    });
    expect(result.status()).toBe(401);
    expect(result.headers()["cache-control"]).toContain("no-store");
    expect((await result.json()).data).toBeUndefined();
  }
});

test("source registry, review, versions, withdrawal, audit and secure logout", async ({
  page,
}, info) => {
  const base = process.env.E2E_BASE_URL || "http://127.0.0.1:8787";
  expect(new URL(base).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const secrets = JSON.parse(
    readFileSync(".map-tools/s3-a/local-secrets.json", "utf8"),
  );
  const name = "隔离测试来源 " + randomUUID().slice(0, 8);
  const root = process.env.CONSOLE_E2E_ARTIFACT_DIR || "docs/verification/s3-a";
  mkdirSync(root, { recursive: true });
  const prefix = `${root}/${process.env.PLAYWRIGHT_CHANNEL || "chromium"}-${info.project.name}`;
  await page.goto("/admin");
  await page
    .getByLabel("管理员访问密钥", { exact: true })
    .fill(secrets.CONSOLE_LOCAL_ACCESS_KEY);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "总览", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("手动采集已就绪", { exact: true })).toBeVisible();
  await page.screenshot({ path: prefix + "-overview.png", fullPage: true });

  const auth = (await (await page.request.get("/api/console-auth")).json())
    .data;
  expect(auth.authenticated).toBe(true);
  const badOrigin = await page.request.post("/api/admin/sources", {
    data: {},
    headers: {
      Origin: "https://attacker.invalid",
      "X-Console-CSRF": auth.csrf,
    },
  });
  expect(badOrigin.status()).toBe(403);
  expect(
    (
      await page.request.post("/api/admin/sources", {
        data: {},
        headers: { Origin: base },
      })
    ).status(),
  ).toBe(403);

  await page.getByRole("link", { name: "信息源", exact: true }).first().click();
  await expect(page.locator(".console-source-row")).toHaveCount(20);
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.locator(".console-source-row")).toHaveCount(20);
  await page.getByLabel("搜索信息源").fill("GDUFS-SRC-0001");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.locator(".console-source-row")).toHaveCount(1);
  await page.locator(".console-source-row").click();
  await expect(page.getByRole("heading", { name: "来源证据" })).toBeVisible();
  await expect(page.locator(".console-provenance").first()).toContainText(
    "2026-10-17",
  );

  await page.getByRole("link", { name: "信息源", exact: true }).first().click();
  await page.getByRole("link", { name: "登记来源", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill(name);
  await page
    .getByRole("combobox", { name: "类型", exact: true })
    .selectOption("manual_import");
  await page.getByLabel("所属机构", { exact: true }).fill("本地测试夹具");
  await page
    .getByLabel("证据链接", { exact: true })
    .fill("https://example.invalid/proof/" + randomUUID());
  await page.getByRole("button", { name: "保存信息源", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/sources\?record=source-/);
  const sourceId = new URL(page.url()).searchParams.get("record")!;
  await page.getByRole("button", { name: "启用来源", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("核验");
  await page.getByRole("button", { name: "核验来源", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog
    .getByRole("combobox", { name: "官方主体", exact: true })
    .selectOption("unofficial");
  await dialog
    .getByRole("combobox", { name: "采集许可", exact: true })
    .selectOption("approved");
  await dialog
    .getByLabel("核验说明", { exact: true })
    .fill("隔离夹具：人工确认，不是真实采集内容");
  await dialog.getByRole("button", { name: "保存核验", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator(".console-heading .console-badge").first(),
  ).toHaveText("已核验");
  await page.getByRole("button", { name: "启用来源", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停来源", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: prefix + "-source.png", fullPage: true });

  await page.getByRole("link", { name: "采集任务", exact: true }).click();
  await expect(page.getByText("手动采集已就绪", { exact: true })).toBeVisible();
  const jobs = (await (await page.request.get("/api/admin/jobs")).json()).data
    .items;
  if (jobs.length)
    await expect(page.locator(".console-job")).toHaveCount(jobs.length);
  else await expect(page.getByText("暂无采集任务。")).toBeVisible();
  await page.getByRole("link", { name: "内容记录", exact: true }).click();
  await page.getByRole("link", { name: "登记内容", exact: true }).click();
  await page.getByLabel("查找信息源", { exact: true }).fill(name);
  await expect(
    page
      .getByRole("combobox", { name: "信息源", exact: true })
      .locator("option"),
  ).toHaveCount(2);
  await page
    .getByRole("combobox", { name: "信息源", exact: true })
    .selectOption(sourceId);
  await page.getByLabel("标题", { exact: true }).fill("隔离审核夹具 " + name);
  await page
    .getByRole("combobox", { name: "原文类型", exact: true })
    .selectOption("guide");
  await page
    .getByRole("combobox", { name: "使用范围", exact: true })
    .selectOption("licensed_full_text");
  await page
    .getByRole("combobox", { name: "知识分类", exact: true })
    .selectOption("campus_life");
  await page
    .getByLabel("原文链接", { exact: true })
    .fill("https://example.invalid/article/" + randomUUID());
  const body =
    "隔离测试，不是真实文章。<script>window.consoleXss=true</script><img src=x onerror=alert(1)>";
  await page.getByLabel("正文", { exact: true }).fill(body);
  await page.getByRole("button", { name: "预览正文", exact: true }).click();
  await expect(page.getByTestId("content-safe-preview")).toHaveText(body);
  expect(
    await page.evaluate(
      () => (window as Window & { consoleXss?: boolean }).consoleXss,
    ),
  ).toBeUndefined();
  await expect(
    page.getByTestId("content-safe-preview").locator("script,img"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "保存内容", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/content\?record=content-/);
  const contentId = new URL(page.url()).searchParams.get("record")!;
  await page
    .getByLabel("审核说明", { exact: true })
    .fill("隔离测试：确认人工审核及来源");
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("审核");
  await page.getByRole("button", { name: "批准", exact: true }).click();
  await expect(
    page.locator(".console-badge").filter({ hasText: "已批准" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await expect(
    page.locator(".console-heading .console-badge").first(),
  ).toHaveText("已发布");
  await page.getByRole("button", { name: /^版本 1 ·/ }).click();
  await expect(
    page.getByRole("button", { name: "恢复为新版本", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "恢复为新版本", exact: true }).click();
  await expect(
    page.locator(".console-heading .console-badge").first(),
  ).toHaveText("草稿");
  await page.getByRole("button", { name: "批准", exact: true }).click();
  await expect(
    page.locator(".console-badge").filter({ hasText: "已批准" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await expect(
    page.locator(".console-heading .console-badge").first(),
  ).toHaveText("已发布");
  await page.getByRole("button", { name: "撤回", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.locator(".console-heading .console-badge").first(),
  ).toHaveText("已发布");
  await page.getByRole("button", { name: "撤回", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "撤回", exact: true })
    .click();
  await expect(
    page.locator(".console-heading .console-badge").first(),
  ).toHaveText("已撤回");
  await page.screenshot({ path: prefix + "-content.png", fullPage: true });

  await page.getByRole("link", { name: "审计日志", exact: true }).click();
  await expect(
    page.locator(".console-audit-row").filter({ hasText: contentId }).first(),
  ).toBeVisible();
  await expect(
    page
      .locator(".console-audit-row")
      .filter({ hasText: contentId })
      .filter({ hasText: "document.withdraw" }),
  ).toBeVisible();
  await page.screenshot({ path: prefix + "-audit.png", fullPage: true });
  await page.goto("/admin/sources?record=" + sourceId);
  await page.getByRole("button", { name: "归档来源" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "归档", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/sources$/);
  const sourceReply = await page.request.get("/api/admin/sources/" + sourceId);
  expect(sourceReply.status()).toBe(404);
  await page.getByRole("button", { name: "安全退出" }).click();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/admin/overview")).status()).toBe(401);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
});

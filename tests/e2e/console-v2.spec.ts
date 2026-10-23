import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
test.skip(
  process.env.CONSOLE_V2_LOCAL_E2E !== "1",
  "Dedicated local Worker / isolated fixtures only",
);
test.use({ trace: "off" });
test.setTimeout(90000);
test("V2 five menus, governed non-web sources, soft deletion and legacy routes", async ({
  page,
}, info) => {
  const base = process.env.E2E_BASE_URL!;
  expect(new URL(base).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const secrets = JSON.parse(
    readFileSync(".map-tools/s3-a/local-secrets.json", "utf8"),
  );
  await page.goto("/admin");
  await page
    .getByLabel("管理员访问密钥", { exact: true })
    .fill(secrets.CONSOLE_LOCAL_ACCESS_KEY);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "内容运营总览", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "后台导航" }).getByRole("link"),
  ).toHaveText(["总览", "信息源", "文章", "官网采集", "公众号采集", "过时信息清理", "白名单"]);
  const auth = (await (await page.request.get("/api/console-auth")).json())
    .data;
  expect(
    (
      await page.request.post("/api/admin/v2/settings", {
        data: {},
        headers: {
          Origin: "https://attacker.invalid",
          "X-Console-CSRF": auth.csrf,
        },
      })
    ).status(),
  ).toBe(403);
  await page.getByRole("link", { name: "信息源", exact: true }).first().click();
  await page.getByRole("link", { name: "添加信息源", exact: true }).click();
  const name = "V2隔离来源 " + randomUUID().slice(0, 8),
    program = "wx-fixture-" + randomUUID();
  await page.getByLabel("名称", { exact: true }).fill(name);
  await page
    .getByRole("combobox", { name: "载体", exact: true })
    .selectOption("mini_program");
  await expect(
    page.getByLabel("官网或公开账号链接", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("小程序标识", { exact: true }).fill(program);
  await page
    .getByLabel("所属机构", { exact: true })
    .fill("隔离测试，不是真实来源");
  await page.getByRole("button", { name: "保存信息源", exact: true }).click();
  await expect(page).toHaveURL(/record=source-/);
  const sourceId = new URL(page.url()).searchParams.get("record")!;
  await page.getByRole("button", { name: "启用", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停运", exact: true }),
  ).toBeVisible();
  const stored = (
    await (await page.request.get("/api/admin/v2/sources/" + sourceId)).json()
  ).data;
  expect(stored.enabled).toBe(true);
  expect(stored.automatic).toBe(false);
  expect(stored.websiteUrl).toBeNull();
  expect(stored.miniProgramId).toBe(program);
  const peer = {
    commandId: randomUUID(),
    displayName: name,
    sourceType: "wechat_subscription",
    organization: "另一个隔离主体",
    websiteUrl: null,
    wechatId: "gh_" + randomUUID().replaceAll("-", "").slice(0, 16),
    campusScope: "all",
    evidenceUrls: [],
    priority: 3,
    connectorType: "disabled",
    fetchPolicy: { mode: "disabled", maxRequests: 0 },
  };
  expect(
    (
      await page.request.post("/api/admin/v2/sources", {
        data: peer,
        headers: { Origin: base, "X-Console-CSRF": auth.csrf },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "停运", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "启用", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "启用", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停运", exact: true }),
  ).toBeVisible();
  const dir =
    process.env.CONSOLE_V2_EVIDENCE_DIR ||
    "docs/verification/console-v2/e/browser";
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-source.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "删除来源", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "恢复来源", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "恢复来源", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "启用", exact: true }),
  ).toBeVisible();
  await page.goto("/admin/sources");
  await page.getByText("筛选与排序", { exact: true }).click();
  await page.getByLabel("搜索信息源", { exact: true }).fill(name);
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect(page.locator(".console-v2-source")).toHaveCount(2);
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-sources.png`,
    fullPage: true,
  });
  await page.goto("/admin/jobs");
  await expect(page).toHaveURL(/\/admin\/web-collection\?view=jobs/);
  await expect(
    page.getByRole("heading", { name: "官网采集", exact: true }),
  ).toBeVisible();
  await page.goto("/admin/audit");
  await expect(page).toHaveURL(/view=history/);
  await expect(page.locator(".console-audit-row").first()).toBeVisible();
  await page.goto(`/admin/whitelist?type=source&target=${sourceId}`);
  await expect(page.getByLabel("保护原因", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "白名单状态", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "加入白名单", exact: true }).click();
  await expect(page.getByText("已加入1项", { exact: true })).toBeVisible();
  const row = page.locator(".console-whitelist-row").filter({ hasText: name });
  await expect(row).toContainText("永久保护");
  const cb = row.getByRole("checkbox");
  const bounds = await cb.boundingBox(),
    card = await row.boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(20);
  expect(bounds!.height).toBeLessThanOrEqual(20);
  expect(card!.x + card!.width - (bounds!.x + bounds!.width)).toBeLessThan(24);
  await cb.check();
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-whitelist.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: /移除所选/ }).click();
  await expect(page.getByText("已移除1项", { exact: true })).toBeVisible();
  await page.goto(`/admin/sources?view=import&source=${sourceId}`);
  await expect(page.getByLabel("包含发布时间", { exact: true })).toHaveCount(0);
  await expect(
    page.getByLabel("原文发布日期", { exact: true }),
  ).toHaveAttribute("type", "datetime-local");
  await expect(page.getByLabel("原文发布日期", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    page.getByLabel("更新版本（已有记录时）", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "返回信息源", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("record=" + sourceId));
  await page.goto("/admin/retention");
  await page
    .getByLabel("截止日期（不含当天，北京时间）", { exact: true })
    .fill("1900-01-01");
  await page
    .getByRole("button", { name: "创建只读清理预览", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "继续预览（最多5篇）", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "继续预览（最多5篇）", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "预览完成", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认批量标记", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page.getByRole("button", { name: "确认批量标记", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认标记", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "永久清理（分批）", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-retention.png`,
    fullPage: true,
  });
  await page.goto("/admin");
  await expect(page.locator("main > .console-v2-filters")).toHaveCount(0);
  await expect(page.getByText("官网同步设置", { exact: true })).toHaveCount(0);
  await expect(page.getByText("执行器授权", { exact: true })).toHaveCount(0);
  await page.goto("/admin/web-collection");
  await expect(
    page.getByRole("heading", { name: "官网采集", exact: true }),
  ).toBeVisible();
  await page.getByLabel("统一采集间隔", { exact: true }).selectOption("3");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已保存统一间隔", { exact: true })).toBeVisible();
  const sync = (await (await page.request.get("/api/admin/v2/settings")).json())
    .data;
  expect(sync.sync_hours).toBe(3);
  await page.getByLabel("统一采集间隔", { exact: true }).selectOption("24");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/admin/v2/settings")).json()).data
          .sync_hours,
    )
    .toBe(24);
  await expect(
    page.getByRole("heading", { name: "内容运营总览", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-dashboard.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "安全退出", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
});

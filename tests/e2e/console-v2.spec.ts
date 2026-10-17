import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
test.skip(
  process.env.CONSOLE_V2_LOCAL_E2E !== "1",
  "Dedicated local Worker / isolated fixtures only",
);
test.use({ trace: "off" });
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
  ).toHaveText(["总览", "信息源", "内容审核", "过时信息清理", "白名单"]);
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
  await page
    .getByLabel("关联证据链接", { exact: true })
    .fill("https://example.invalid/relation");
  await page
    .getByLabel("当前运营证据链接", { exact: true })
    .fill("https://example.invalid/current");
  await page.getByLabel("已确认与广外相关", { exact: true }).check();
  await page.getByLabel("已确认现在正常运作", { exact: true }).check();
  await page
    .getByLabel("关联及运营说明", { exact: true })
    .fill("隔离夹具核验，不代表真实学校信息源");
  await page.getByRole("button", { name: "保存信息源", exact: true }).click();
  await expect(page).toHaveURL(/record=source-/);
  const sourceId = new URL(page.url()).searchParams.get("record")!;
  await expect(
    page.getByRole("button", { name: "暂停来源", exact: true }),
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
  await page.getByRole("button", { name: "暂停来源", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "启用来源", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "启用来源", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停来源", exact: true }),
  ).toBeVisible();
  const dir = "docs/verification/console-v2/a/browser";
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-source.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "删除来源", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "删除来源", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "删除来源", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "恢复来源", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "恢复来源", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "启用来源", exact: true }),
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
  await expect(page).toHaveURL(/\/admin\?view=jobs/);
  await expect(
    page.getByText("最近运行与采集任务", { exact: true }),
  ).toBeVisible();
  await page.goto("/admin/audit");
  await expect(page).toHaveURL(/view=history/);
  await expect(page.locator(".console-audit-row").first()).toBeVisible();
  await page.getByRole("button", { name: "安全退出", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
});

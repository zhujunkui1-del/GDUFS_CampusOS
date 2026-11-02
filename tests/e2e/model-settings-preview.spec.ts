import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test.use({ trace: "off", video: "off" });
test.skip(process.env.S4_LIVE !== "1", "Explicit owned test-account acceptance");
test("guest can open personal api settings", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await page.goto(
    "https://campusos-preview.zhujunkui1.workers.dev/account/settings/api",
  );
  await expect(page.getByRole("heading", { name: "个人 API 设置" })).toBeVisible();
  await page.getByRole("button", { name: "测试一个模型连接" }).click();
  await expect(page.locator(".account-api-chip")).toHaveCount(13);
  await expect(page.locator(".account-api-note")).toBeVisible();
  await page.getByLabel("配置名称").fill("游客检查");
  await page.getByLabel("接入地址 Base URL").fill("https://127.0.0.1/v1");
  await page.getByLabel("API Key").fill("sk-guest-check");
  await page.getByRole("button", { name: "测试", exact: true }).click();
  await expect(page.locator(".account-api-error")).toContainText(/本机|内网|HTTPS/);
});
test("personal api settings mobile layout", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "mobile only");
  test.setTimeout(90000);
  const a = JSON.parse(
    readFileSync(".map-tools/s4-account-20261031/live-private-accounts.json", "utf8"),
  ).a;
  const origin = "https://campusos-preview.zhujunkui1.workers.dev";
  await page.goto(origin + "/account/login");
  const form = page.getByRole("form", { name: "登录账号", exact: true });
  await form.getByLabel("用户名或邮箱", { exact: true }).fill(a.username);
  await form.getByLabel("密码", { exact: true }).fill(a.password);
  await form.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForResponse((r) => r.url().endsWith("/api/auth/login"));
  await page.goto(origin + "/account/settings/api");
  await expect(page.getByRole("heading", { name: "个人 API 设置" })).toBeVisible();
  await page.getByRole("button", { name: "新增配置" }).click();
  await expect(page.locator(".account-api-chip")).toHaveCount(13);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: ".tmp/api-settings-mobile.png", fullPage: true });
});
test("personal api settings live", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  test.setTimeout(120000);
  const a = JSON.parse(
    readFileSync(".map-tools/s4-account-20261031/live-private-accounts.json", "utf8"),
  ).b;
  const origin = "https://campusos-preview.zhujunkui1.workers.dev";
  await page.goto(origin + "/account/login");
  const form = page.getByRole("form", { name: "登录账号", exact: true });
  await form.getByLabel("用户名或邮箱", { exact: true }).fill(a.username);
  await form.getByLabel("密码", { exact: true }).fill(a.password);
  await form.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForResponse((r) => r.url().endsWith("/api/auth/login"));
  await page.goto(origin + "/account/settings/api");
  await expect(page.getByRole("heading", { name: "个人 API 设置" })).toBeVisible();
  await expect(page.getByRole("button", { name: "平台内置模型" })).toHaveCount(0);
  await page.getByRole("button", { name: "新增配置" }).click();
  await expect(page.locator(".account-api-chip")).toHaveCount(13);
  const chips = page.locator(".account-api-chip");
  console.log("CHIPS", await chips.count());
  await page.getByRole("button", { name: /Claude/ }).click();
  await expect(page.getByLabel("接入地址 Base URL")).toHaveValue(
    "https://api.anthropic.com/v1",
  );
  await page.getByRole("button", { name: /DeepSeek DeepSeek/ }).click();
  await page.getByLabel("配置名称").fill("E2E 配置");
  await page.getByLabel("API Key").fill("sk-e2e-ui-secret");
  const save = page.getByRole("button", { name: "保存", exact: true });
  await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "测试", exact: true }).click();
  await expect(page.locator(".account-api-error")).toBeVisible({ timeout: 30000 });
  await expect(save).toBeDisabled();
  const result = await page.evaluate(async (o) => {
    const post = await fetch(o + "/api/me/model-configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: "E2E 检查",
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "sk-e2e-check-secret",
      }),
    });
    const created = await post.json();
    const list = await (await fetch(o + "/api/me/model-configs")).json();
    const id = created.data?.config?.id;
    const del = id
      ? await fetch(o + "/api/me/model-configs", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        })
      : null;
    return {
      post: post.status,
      created,
      list: list.data,
      del: del?.status ?? null,
    };
  }, origin);
  console.log("API", JSON.stringify(result));
  expect(result.post).toBe(200);
  expect(JSON.stringify(result)).not.toContain("sk-e2e-check-secret");
  expect(result.list.configs.length).toBeGreaterThan(0);
  expect(result.del).toBe(200);
  await page.screenshot({ path: ".tmp/api-settings.png", fullPage: true });
});

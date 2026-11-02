import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

test.use({ trace: "off", video: "off" });
test.skip(process.env.S4_LIVE !== "1", "Explicit owned test-account acceptance");

const origin = "https://campusos-preview.zhujunkui1.workers.dev";

function account() {
  return JSON.parse(
    readFileSync(".map-tools/s4-account-20261031/live-private-accounts.json", "utf8"),
  ).b as { username: string; password: string };
}

async function login(page: Page) {
  const user = account();
  await page.goto(origin + "/account/login");
  const form = page.getByRole("form", { name: "登录账号", exact: true });
  await form.getByLabel("用户名或邮箱", { exact: true }).fill(user.username);
  await form.getByLabel("密码", { exact: true }).fill(user.password);
  const response = page.waitForResponse((r) => r.url().endsWith("/api/auth/login"));
  await form.getByRole("button", { name: "登录", exact: true }).click();
  expect((await response).ok()).toBeTruthy();
}

async function clearFavorites(page: Page) {
  const response = await page.request.get(origin + "/api/me/favorites?limit=50");
  expect(response.ok()).toBeTruthy();
  const data = (await response.json()) as {
    data: { items: { articleId: string }[] };
  };
  for (const item of data.data.items) {
    const removed = await page.request.delete(
      origin + "/api/me/favorites/" + encodeURIComponent(item.articleId),
      { headers: { Origin: origin } },
    );
    expect(removed.ok()).toBeTruthy();
  }
}

test("radar favorite appears in my favorites and can be removed", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "desktop flow");
  test.setTimeout(150000);
  await login(page);
  await clearFavorites(page);

  await page.goto(origin + "/radar");
  await page.waitForFunction(
    () => document.querySelectorAll(".public-feed-card").length > 10,
    undefined,
    { timeout: 30000 },
  );

  const button = page.locator(".favorite-button").first();
  await expect(button).toBeVisible({ timeout: 15000 });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true", {
    timeout: 15000,
  });

  await page.goto(origin + "/account/favorites");
  await expect(page.locator(".favorites-card")).toHaveCount(1, {
    timeout: 20000,
  });
  await page.getByRole("tab", { name: "校园雷达" }).click();
  await expect(page.locator(".favorites-card")).toHaveCount(1);
  await page.getByRole("tab", { name: "校园知识" }).click();
  await expect(page.locator(".favorites-card")).toHaveCount(0);

  await page.getByRole("tab", { name: "全部" }).click();
  await page.locator(".favorites-card-open").first().click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15000 });
  await page.keyboard.press("Escape");

  await page.locator(".favorites-card-remove").first().click();
  await expect(page.locator(".favorites-card")).toHaveCount(0, {
    timeout: 15000,
  });
  await clearFavorites(page);
});

test("favorites guest prompt and mobile layout", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "mobile/guest layout");
  test.setTimeout(90000);
  await page.goto(origin + "/account/favorites");
  await expect(page.getByRole("heading", { name: "我的收藏" })).toBeVisible();
  await expect(page.getByRole("link", { name: /登录/ }).first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

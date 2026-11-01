import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test.use({ trace: "off", video: "off" });
test("same test account logs in at both configured public origins", async ({
  page,
}, info) => {
  test.skip(
    process.env.S4_LIVE !== "1" || info.project.name !== "desktop",
    "Explicit owned test-account acceptance",
  );
  test.setTimeout(90000);
  const a = JSON.parse(
    readFileSync(
      ".map-tools/s4-account-20261031/live-private-accounts.json",
      "utf8",
    ),
  ).a;
  for (const origin of [
    "https://gdufs.ccwu.cc",
    "https://campusos-preview.zhujunkui1.workers.dev",
  ]) {
    await page.goto(origin + "/account/login");
    const form = page.getByRole("form", { name: "登录账号", exact: true });
    await form.getByLabel("用户名或邮箱", { exact: true }).fill(a.username);
    await form.getByLabel("密码", { exact: true }).fill(a.password);
    const response = page.waitForResponse((r) =>
      r.url().endsWith("/api/auth/login"),
    );
    await form.getByRole("button", { name: "登录", exact: true }).click();
    const r = await response;
    await page.evaluate(() =>
      document
        .querySelectorAll<HTMLInputElement>('input[type="password"]')
        .forEach((e) => {
          e.value = "";
        }),
    );
    expect(r.status()).toBe(200);
    expect((await r.json()).data.user.id).toBe(a.id);
    await expect(
      page.getByRole("heading", { name: a.username, exact: true }),
    ).toBeVisible();
    await page.goto(origin + "/map");
    await expect(page.locator(".map-account-avatar")).toHaveText(
      a.username.slice(0, 1).toUpperCase(),
    );
    await page.goto(origin + "/account/settings");
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
  }
});

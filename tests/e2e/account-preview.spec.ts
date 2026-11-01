import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
test.use({ trace: "off", video: "off" });
test("real Preview compact account hierarchy and username editing without passwords or cooldown", async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.S4_LIVE !== "1",
    "Explicit Preview account writes only",
  );
  test.setTimeout(120000);
  expect(process.env.E2E_BASE_URL).toBe(
    "https://campusos-preview.zhujunkui1.workers.dev",
  );
  const out = "verification/account-mail-budget-2026-11-01";
  mkdirSync(out, { recursive: true });
  let username = "s4settings_" + randomBytes(4).toString("hex"),
    password = "12345678";
  await page.goto("/account/register");
  await expect(
    page.getByRole("button", { name: "注册并登录", exact: true }),
  ).toBeEnabled({ timeout: 15000 });
  await expect(page.getByText(/不绑定并验证|待验证邮箱/)).toHaveCount(0);
  const registration = page.getByRole("form", {
    name: "注册账号",
    exact: true,
  });
  await registration.getByLabel("用户名", { exact: true }).fill(username);
  await registration.getByLabel("密码", { exact: true }).fill(password);
  await registration.getByLabel("确认密码", { exact: true }).fill(password);
  await registration
    .getByRole("button", { name: "注册并登录", exact: true })
    .click();
  await expect(page).toHaveURL(/\/account$/, { timeout: 30000 });
  await expect(
    page.getByRole("heading", { name: username, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: username, exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".account-page form")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "收藏", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "API 设置", exact: true }),
  ).toBeDisabled();
  const glass = await page.locator(".account-overview").evaluate((e) => ({
    blur: getComputedStyle(e).backdropFilter,
    bg: getComputedStyle(e).backgroundColor,
  }));
  expect(glass.blur).toContain("blur");
  expect(glass.bg).toContain("rgba");
  await expect(page.getByText(/注册于|当前已登录|待验证邮箱/)).toHaveCount(0);
  await expect(page.getByText("email: 未绑定", { exact: true })).toBeVisible();
  await page.screenshot({
    path: `${out}/${info.project.name}-mine.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/settings$/);
  for (const label of ["修改用户名", "修改密码", "找回密码", "邮箱"])
    await expect(
      page.getByRole("link", { name: new RegExp("^" + label) }),
    ).toBeVisible();
  expect(
    await page
      .getByRole("button", { name: "退出登录", exact: true })
      .evaluate((e) => ({
        bg: getComputedStyle(e).backgroundColor,
        color: getComputedStyle(e).color,
      })),
  ).toEqual({ bg: "rgb(197, 49, 55)", color: "rgb(255, 255, 255)" });
  await page.screenshot({
    path: `${out}/${info.project.name}-settings.png`,
    fullPage: true,
  });
  for (const suffix of ["x", "y"]) {
    await page.getByRole("link", { name: "修改用户名", exact: true }).click();
    const form = page.getByRole("form", { name: "修改用户名", exact: true });
    await expect(form.locator("input[type=password]")).toHaveCount(0);
    await expect(page.getByText(/24小时|当前用户名/)).toHaveCount(0);
    await form.getByLabel("新用户名", { exact: true }).fill(username + suffix);
    await form.getByRole("button", { name: "保存", exact: true }).click();
    username += suffix;
    await expect(
      page.getByRole("heading", { name: username, exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await page.getByRole("link", { name: "设置", exact: true }).click();
  }
  await page.getByRole("link", { name: "邮箱" }).click();
  await expect(page).toHaveURL(/\/settings\/email$/);
  await expect(page.locator("input[type=password]")).toHaveCount(0);
  await expect(page.getByText(/待验证|已验证|不绑定并验证/)).toHaveCount(0);
  await page.screenshot({
    path: `${out}/${info.project.name}-email.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "返回", exact: true }).click();
  await page.getByRole("link", { name: "修改密码", exact: true }).click();
  const change = page.getByRole("form", { name: "修改密码", exact: true }),
    next = randomBytes(20).toString("base64url") + "!";
  await change.getByLabel("当前密码", { exact: true }).fill(password);
  await change.getByLabel("新密码", { exact: true }).fill(next);
  await change.getByLabel("确认新密码", { exact: true }).fill(next);
  await change.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("密码已修改", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  password = next;
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    )
    .toBe(true);
  const other = await context.newPage();
  await other.goto("/account");
  await expect(
    other.getByRole("heading", { name: username, exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("link", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    other.getByRole("heading", { name: "游客", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await other.close();
  await page.getByRole("link", { name: "登录", exact: true }).click();
  const login = page.getByRole("form", { name: "登录账号", exact: true });
  await login
    .getByLabel("用户名或邮箱", { exact: true })
    .fill(username.toUpperCase());
  await login.getByLabel("密码", { exact: true }).fill(password);
  await login.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: username, exact: true }),
  ).toBeVisible({ timeout: 30000 });
  for (const path of ["/calendar", "/radar", "/knowledge", "/map"]) {
    await page.goto(path);
    await expect(page.locator("#main-content")).toBeVisible();
  }
});

test("email code registration and unlink UI contract (isolated browser fixture)", async ({
  page,
}, info) => {
  test.skip(process.env.S4_LIVE !== "1", "Preview UI acceptance only");
  let user: Record<string, unknown> | null = null,
    registered = 0,
    sent = 0;
  const challenge = "A".repeat(43);
  await page.route("**/api/auth/session", (r) =>
    r.fulfill({
      json: { ok: true, data: { available: true, mailAvailable: true, user } },
    }),
  );
  await page.route("**/api/auth/register/email-code", async (r) => {
    expect(r.request().postDataJSON()).toEqual({
      username: "MailFixture",
      email: "fixture@example.com",
    });
    sent++;
    await r.fulfill({ json: { ok: true, data: { challenge } } });
  });
  await page.route("**/api/auth/register", async (r) => {
    const input = r.request().postDataJSON();
    expect(input).toMatchObject({
      username: "MailFixture",
      email: "fixture@example.com",
      challenge,
      code: "123456",
    });
    registered++;
    user = {
      id: "browser-mail-fixture",
      username: "MailFixture",
      email: "fixture@example.com",
      pendingEmail: null,
      createdAt: "2026-11-01T00:00:00Z",
    };
    await r.fulfill({ json: { ok: true, data: { user } } });
  });
  await page.route("**/api/auth/email/unbind/request", async (r) => {
    expect(r.request().postDataJSON()).toEqual({});
    await r.fulfill({ json: { ok: true, data: { challenge } } });
  });
  await page.route("**/api/auth/email/bind", (r) =>
    r.fulfill({ json: { ok: true, data: { challenge } } }),
  );
  await page.route("**/api/auth/email/unbind", async (r) => {
    expect(r.request().postDataJSON()).toEqual({ challenge, code: "123456" });
    user = { ...user, email: null };
    await r.fulfill({ json: { ok: true, data: { user } } });
  });
  await page.goto("/account/register");
  const form = page.getByRole("form", { name: "注册账号", exact: true });
  await expect(form.getByRole("button", { name: "注册并登录" })).toBeEnabled();
  await form.getByLabel("用户名", { exact: true }).fill("MailFixture");
  await form.getByLabel("密码", { exact: true }).fill("12345678");
  await form.getByLabel("确认密码", { exact: true }).fill("12345678");
  await form
    .getByLabel("邮箱（可选）", { exact: true })
    .fill("fixture@example.com");
  await form.getByRole("button", { name: "注册并登录", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("验证码");
  expect(registered).toBe(0);
  await form.getByRole("button", { name: "获取验证码", exact: true }).click();
  await expect.poll(() => sent).toBe(1);
  await expect(form.getByRole("button", { name: /秒后重发/ })).toBeDisabled();
  await form.getByLabel("邮箱验证码", { exact: true }).fill("123456");
  await form.getByRole("button", { name: "注册并登录", exact: true }).click();
  await expect(
    page.getByText("email: fixture@example.com", { exact: true }),
  ).toBeVisible();
  expect(registered).toBe(1);
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.getByRole("link", { name: /^邮箱/ }).click();
  const link = page.getByRole("link", { name: "解绑邮箱", exact: true });
  expect(await link.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
    "rgb(197, 49, 55)",
  );
  await link.click();
  const unlink = page.getByRole("form", { name: "解绑邮箱", exact: true });
  await expect(unlink.locator("input[type=password]")).toHaveCount(0);
  await unlink.getByRole("button", { name: "获取验证码", exact: true }).click();
  await expect(page.getByText("已发送", { exact: true })).toBeVisible();
  await expect(unlink.getByRole("button", { name: /秒后重发/ })).toBeDisabled();
  await unlink.getByLabel("邮箱验证码", { exact: true }).fill("123456");
  await page.screenshot({
    path: `verification/account-mail-budget-2026-11-01/${info.project.name}-unlink-fixture.png`,
    fullPage: true,
  });
  await unlink.getByRole("button", { name: "解绑邮箱", exact: true }).click();
  await expect(
    page.getByRole("form", { name: "绑定邮箱", exact: true }),
  ).toBeVisible();
  const bind = page.getByRole("form", { name: "绑定邮箱", exact: true });
  await bind
    .getByLabel("邮箱地址", { exact: true })
    .fill("fixture@example.com");
  await bind.getByRole("button", { name: "获取验证码", exact: true }).click();
  await expect(bind.getByRole("button", { name: /秒后重发/ })).toBeDisabled();
});

test("recovery code cooldown is 60 seconds, survives refresh and does not start on failure (UI fixture)", async ({
  page,
}, info) => {
  test.skip(process.env.S4_LIVE !== "1", "Preview UI acceptance only");
  await page.clock.install();
  let calls = 0;
  await page.route("**/api/auth/session", (r) =>
    r.fulfill({
      json: {
        ok: true,
        data: { available: true, mailAvailable: true, user: null },
      },
    }),
  );
  await page.route("**/api/auth/password/reset/request", (r) => {
    calls++;
    return r.fulfill({
      status: calls === 1 ? 503 : 200,
      json:
        calls === 1
          ? { ok: false, error: { message: "发送失败" } }
          : { ok: true, data: { challenge: "A".repeat(43) } },
    });
  });
  await page.goto("/account/forgot-password");
  const form = page.getByRole("form", { name: "重置密码", exact: true });
  await form.getByLabel("邮箱", { exact: true }).fill("fixture@example.com");
  await form.getByRole("button", { name: "获取验证码", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("发送失败");
  await expect(
    form.getByRole("button", { name: "获取验证码", exact: true }),
  ).toBeEnabled();
  await form.getByRole("button", { name: "获取验证码", exact: true }).click();
  await expect(
    form.getByRole("button", { name: "60秒后重发", exact: true }),
  ).toBeDisabled();
  expect(calls).toBe(2);
  mkdirSync("verification/account-mail-budget-2026-11-01", { recursive: true });
  await page.screenshot({
    path: `verification/account-mail-budget-2026-11-01/${info.project.name}-cooldown.png`,
    fullPage: true,
  });
  await page.clock.fastForward(59000);
  await expect(
    form.getByRole("button", { name: "1秒后重发", exact: true }),
  ).toBeDisabled();
  expect(calls).toBe(2);
  await page.clock.fastForward(1000);
  await expect(
    form.getByRole("button", { name: "获取验证码", exact: true }),
  ).toBeEnabled();
  await form.getByRole("button", { name: "获取验证码", exact: true }).click();
  await expect(
    form.getByRole("button", { name: "60秒后重发", exact: true }),
  ).toBeDisabled();
  expect(calls).toBe(3);
  await page.reload();
  await expect(page.getByRole("button", { name: /秒后重发/ })).toBeDisabled();
  expect(calls).toBe(3);
});

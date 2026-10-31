import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
test.use({ trace: "off", video: "off" });
test("real Preview registration, persisted login, logout and public pages", async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.S4_LIVE !== "1",
    "Explicit Preview account-write acceptance only",
  );
  test.setTimeout(120000);
  expect(process.env.E2E_BASE_URL).toBe(
    "https://campusos-preview.zhujunkui1.workers.dev",
  );
  const output = "verification/account-2026-11-01";
  mkdirSync(output, { recursive: true });
  let username = "s4ui_" + randomBytes(5).toString("hex"),
    password = randomBytes(20).toString("base64url") + "!";
  await page.goto("/account/register");
  await expect(
    page.getByRole("button", { name: "注册并登录", exact: true }),
  ).toBeEnabled({ timeout: 15000 });
  await expect(
    page.getByText("不绑定并验证邮箱，忘记密码后将无法通过邮件找回账号。"),
  ).toBeVisible();
  await page.screenshot({
    path: `${output}/${info.project.name}-register.png`,
    fullPage: true,
  });
  const form = page.getByRole("form", { name: "注册账号", exact: true });
  await form.getByLabel("用户名", { exact: true }).fill(username);
  await form.getByLabel("密码", { exact: true }).fill(password);
  await form.getByLabel("确认密码", { exact: true }).fill(password);
  await form.getByRole("button", { name: "注册并登录", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/, { timeout: 40000 });
  await expect(
    page.getByRole("heading", { name: username, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: username, exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await page.screenshot({
    path: `${output}/${info.project.name}-profile.png`,
    fullPage: true,
  });
  const session = context
    .cookies()
    .then((c) => c.find((x) => x.name === "campusos_session"));
  expect(await session).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
  });
  await expect
    .poll(async () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    )
    .toBe(true);
  const rename = page.getByRole("form", { name: "修改用户名", exact: true });
  await rename.getByLabel("新用户名", { exact: true }).fill(username + "_new");
  await rename
    .getByLabel("当前密码（修改用户名）", { exact: true })
    .fill(password);
  await rename.getByRole("button", { name: "保存用户名", exact: true }).click();
  username += "_new";
  await expect(
    page.getByRole("heading", { name: username, exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const change = page.getByRole("form", { name: "修改密码", exact: true }),
    nextPassword = randomBytes(20).toString("base64url") + "!";
  await change
    .getByLabel("当前密码（修改密码）", { exact: true })
    .fill(password);
  await change.getByLabel("新密码", { exact: true }).fill(nextPassword);
  await change.getByLabel("确认新密码", { exact: true }).fill(nextPassword);
  await change.getByRole("button", { name: "保存新密码", exact: true }).click();
  await expect(
    page.getByText("密码已修改，旧登录会话已撤销", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  password = nextPassword;
  const second = await context.newPage();
  await second.goto("/account");
  await expect(
    second.getByRole("heading", { name: username, exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "游客模式", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    second.getByRole("heading", { name: "游客模式", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await second.close();
  await page.getByRole("link", { name: "登录账号", exact: true }).click();
  const login = page.getByRole("form", { name: "登录账号", exact: true });
  await login
    .getByLabel("用户名或邮箱", { exact: true })
    .fill(username.toUpperCase());
  await login.getByLabel("密码", { exact: true }).fill(password);
  await login.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: username, exact: true }),
  ).toBeVisible({ timeout: 40000 });
  for (const path of ["/calendar", "/radar", "/knowledge", "/map"]) {
    await page.goto(path);
    await expect(page.locator("#main-content")).toBeVisible();
    expect(page.url()).toContain(path);
  }
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: username, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "游客模式", exact: true }),
  ).toBeVisible();
});

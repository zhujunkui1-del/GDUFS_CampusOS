import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { previewConsoleCredential } from "./helpers/console-credential";
test.skip(
  process.env.CLOUD_SEARCH_LIVE !== "1",
  "Explicit Preview UI regression",
);
test.use({ trace: "off" });
test("checking status preserves a pending QR and polling completes login", async ({
  page,
}) => {
  let confirmed = false,
    polls = 0;
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  await page.route("**/api/admin/v2/source-session", async (route) => {
    const req = route.request(),
      body = req.method() === "POST" ? req.postDataJSON() : {};
    if (req.method() === "GET") polls++;
    await route.fulfill({
      json: {
        ok: true,
        data: {
          state: confirmed ? "logged_in" : "login_required",
          checkedAt: Date.now(),
          location: "cloud",
          qr: body.action === "login" ? png : null,
          qrExpiresAt: body.action === "login" ? Date.now() + 180000 : null,
        },
      },
    });
  });
  await page.goto("/admin");
  const values = JSON.parse(
    readFileSync(".map-tools/s3-a/preview-secrets.json", "utf8"),
  );
  await page
    .getByLabel("管理员访问密钥", { exact: true })
    .fill(previewConsoleCredential(values));
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const login = page.getByRole("button", { name: "重新登录", exact: true });
  await expect(login).toBeEnabled({ timeout: 30000 });
  await login.click();
  await expect(page.getByAltText("小红书登录二维码")).toBeVisible();
  await page.getByRole("button", { name: "检测登录状态", exact: true }).click();
  await expect(page.getByAltText("小红书登录二维码")).toBeVisible();
  confirmed = true;
  await expect(page.locator(".console-session-state")).toHaveText("已登录", {
    timeout: 15000,
  });
  expect(polls).toBeGreaterThan(0);
  await expect(page.getByAltText("小红书登录二维码")).toHaveCount(0);
});
test("real administrator can open a private cloud verification session", async ({
  page,
}) => {
  await page.goto("/admin");
  const values = JSON.parse(
    readFileSync(".map-tools/s3-a/preview-secrets.json", "utf8"),
  );
  await page
    .getByLabel("管理员访问密钥", { exact: true })
    .fill(previewConsoleCredential(values));
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const panel = page.locator(".console-source-session");
  await expect(
    panel.getByRole("button", { name: "连接云端登录", exact: true }),
  ).toBeEnabled({ timeout: 40000 });
  await panel
    .getByRole("button", { name: "连接云端登录", exact: true })
    .click();
  const link = panel.getByRole("link", { name: "打开云端登录页", exact: true });
  await expect(link).toBeVisible({ timeout: 40000 });
  const url = new URL((await link.getAttribute("href"))!);
  expect(url.origin).toBe("https://live.browser.run");
  expect(url.pathname.startsWith("/ui/")).toBe(true);
  await mkdir("docs/verification/cloud-search", { recursive: true });
  await writeFile(
    "docs/verification/cloud-search/admin-verification.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        privateCloudViewerAvailable: true,
        publicUrlNotRecorded: true,
      },
      null,
      2,
    ),
  );
});

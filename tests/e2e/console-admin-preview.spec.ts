import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test.skip(
  process.env.CONSOLE_CLOUD_ADMIN_E2E !== "1",
  "Explicit isolated HTTPS administrator acceptance only",
);
test("real preview key login, catalog read, refresh recovery and revoked-cookie replay", async ({
  page,
  request,
}, info) => {
  expect(process.env.E2E_BASE_URL).toBe(
    "https://campusos-preview.zhujunkui1.workers.dev",
  );
  const values = JSON.parse(
    readFileSync(".map-tools/s3-a/preview-secrets.json", "utf8"),
  );
  await page.goto("/admin");
  await page
    .getByLabel("管理员访问密钥", { exact: true })
    .fill(values.CONSOLE_ADMIN_ACCESS_KEY);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "总览", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".console-stats .console-card")
      .filter({ hasText: "信息源" })
      .locator("strong"),
  ).toHaveText("220");
  const authentication = (
    await (await page.request.get("/api/console-auth")).json()
  ).data;
  expect(authentication.authenticated).toBe(true);
  expect(authentication.mode).toBe("key");
  const cookie = (await page.context().cookies()).find(
    (x) => x.name === "campusos_console",
  )!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.secure).toBe(true);
  expect(cookie.sameSite).toBe("Strict");
  // Real mutation gate tests must fail before any business row is changed.
  const noCsrf = await page.request.post("/api/admin/sources", { data: {} });
  expect(noCsrf.status()).toBe(403);
  const crossOrigin = await page.request.post("/api/admin/sources", {
    data: {},
    headers: {
      Origin: "https://attacker.invalid",
      "X-Console-CSRF": authentication.csrf,
    },
  });
  expect(crossOrigin.status()).toBe(403);
  await page.getByRole("link", { name: "信息源", exact: true }).first().click();
  await expect(page.locator(".console-source-row")).toHaveCount(20);
  await page.getByLabel("搜索信息源").fill("GDUFS-SRC-0001");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.locator(".console-source-row")).toHaveCount(1);
  await page.locator(".console-source-row").click();
  await expect(
    page.getByRole("heading", { name: "来源证据", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "来源证据", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".console-provenance").first()).toContainText(
    "2026-10-17",
  );
  await page.screenshot({
    path: `${process.env.CONSOLE_E2E_ARTIFACT_DIR || "docs/verification/s3-a"}/admin-preview-${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-source.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "内容记录", exact: true }).click();
  const content = (await (await page.request.get("/api/admin/content")).json())
    .data.items;
  if (content.length)
    await expect(page.locator(".console-source-row")).toHaveCount(
      content.length,
    );
  else
    await expect(
      page.getByText("暂无内容记录。", { exact: true }),
    ).toBeVisible();
  await page.getByRole("link", { name: "采集任务", exact: true }).click();
  const jobs = (await (await page.request.get("/api/admin/jobs")).json()).data
    .items;
  if (jobs.length)
    await expect(page.locator(".console-job")).toHaveCount(jobs.length);
  else
    await expect(
      page.getByText("暂无采集任务。", { exact: true }),
    ).toBeVisible();
  await page.getByRole("link", { name: "审计日志", exact: true }).click();
  await expect(
    page
      .locator(".console-audit-row")
      .filter({ hasText: "auth.login" })
      .first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "安全退出" }).click();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  const replay = await request.get("/api/admin/sources", {
    headers: { Cookie: `campusos_console=${cookie.value}` },
  });
  expect(replay.status()).toBe(401);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
});

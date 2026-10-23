import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { previewConsoleCredential } from "./helpers/console-credential";

test.skip(
  process.env.OFFICIAL_WEB_PREVIEW !== "1",
  "Explicit read-only verification of imported candidate profiles",
);
test.setTimeout(60000);
test.use({ trace: "off" });

test("preview shows discovered paths as candidates and blocks collection before review", async ({
  page,
}) => {
  expect(process.env.E2E_BASE_URL).toBe(
    "https://campusos-preview.zhujunkui1.workers.dev",
  );
  await page.goto("/admin/web-collection");
  const secrets = JSON.parse(
    readFileSync(".map-tools/s3-a/preview-secrets.json", "utf8"),
  );
  await page
    .getByLabel("管理员访问密钥", { exact: true })
    .fill(previewConsoleCredential(secrets));
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "官网采集", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByText("109 个官网", { exact: true }).first(),
  ).toBeVisible();

  await page.getByLabel("搜索官网", { exact: true }).fill("人力资源部");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  const row = page.locator(".console-web-source-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("3 个候选入口");
  await expect(row).toContainText("待核对规则");
  await expect(row).toContainText("许可需核验");
  await expect(
    row.getByRole("button", { name: "立即采集", exact: true }),
  ).toBeDisabled();
  await expect(
    row.getByRole("button", { name: "配置入口", exact: true }),
  ).toBeEnabled();
});

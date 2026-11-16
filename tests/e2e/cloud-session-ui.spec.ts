import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { previewConsoleCredential } from "./helpers/console-credential";

test.skip(
  process.env.CLOUD_SEARCH_LIVE !== "1",
  "Explicit Preview UI regression",
);
test.use({ trace: "off" });

test("the dashboard no longer opens or polls the Xiaohongshu login panel", async ({
  page,
}) => {
  let polls = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname.startsWith("/api/admin/v2/source-session")
    )
      polls++;
  });
  await page.goto("/admin");
  const values = JSON.parse(
    readFileSync(".map-tools/s3-a/preview-secrets.json", "utf8"),
  );
  await page
    .getByLabel("管理员访问密钥", { exact: true })
    .fill(previewConsoleCredential(values));
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "D1存储", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "小红书登录状态", exact: true }),
  ).toHaveCount(0);
  expect(polls).toBe(0);
  await page.getByRole("button", { name: "安全退出", exact: true }).click();
});

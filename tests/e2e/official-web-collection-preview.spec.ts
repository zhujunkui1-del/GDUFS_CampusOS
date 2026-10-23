import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { previewConsoleCredential } from "./helpers/console-credential";

test.skip(
  process.env.OFFICIAL_WEB_PREVIEW !== "1",
  "Explicit official-web preview acceptance and one-time manual collection",
);
test.setTimeout(90000);
test.use({ trace: "off" });

test("preview exposes global official-web controls and accepts one collection run", async ({
  page,
}, info) => {
  expect(process.env.E2E_BASE_URL).toBe(
    "https://campusos-preview.zhujunkui1.workers.dev",
  );
  await page.goto("/admin");
  const credential = JSON.parse(
    readFileSync(".map-tools/s3-a/preview-secrets.json", "utf8"),
  );
  await page
    .getByLabel("管理员访问密钥", { exact: true })
    .fill(previewConsoleCredential(credential));
  await page.getByRole("button", { name: "登录", exact: true }).click();

  const webCollectionLink = page.getByRole("link", {
    name: "官网采集",
    exact: true,
  });
  await expect(webCollectionLink).toBeVisible({ timeout: 30000 });
  await page.getByRole("link", { name: "总览", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "内容运营总览", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".console-v2-metrics .console-card")).toHaveCount(
    6,
    { timeout: 30000 },
  );
  for (const removedMetric of [
    "今日发现出处",
    "未发布",
    "采集异常",
    "发布阻断",
    "撤回或过期",
  ])
    await expect(page.getByText(removedMetric, { exact: true })).toHaveCount(0);

  await webCollectionLink.click();
  await expect(
    page.getByRole("heading", { name: "官网采集", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel("搜索官网", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByLabel("统一采集间隔")).toBeVisible();
  const globalCounts = page.getByText(/全站已配置入口 \d+ \/ \d+ 个官网/);
  await expect(globalCounts).toBeVisible();
  console.log("OFFICIAL_WEB_GLOBAL_COUNTS", await globalCounts.innerText());
  const collectButton = page
    .locator(".console-web-global-controls")
    .getByRole("button", { name: "立即采集", exact: true });
  await expect(collectButton).toBeEnabled();
  await collectButton.click();
  const collectionResult = page
    .locator(".console-card")
    .first()
    .getByRole("status");
  await expect(collectionResult).toContainText(
    /未登记任务：|已登记 \d+ 个采集任务，等待执行器处理|调度器仍在登记其他任务/,
    { timeout: 30000 },
  );
  console.log(
    "OFFICIAL_WEB_GLOBAL_COLLECTION_RESULT",
    await collectionResult.innerText(),
  );
  await page.screenshot({
    path: info.outputPath("official-web-collection-preview.png"),
    fullPage: true,
  });
});

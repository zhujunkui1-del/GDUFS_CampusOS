import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { previewConsoleCredential } from "./helpers/console-credential";
test.skip(
  process.env.TWO_STATE_PREVIEW_E2E !== "1",
  "Read-only verification of the owner's two published articles",
);
test.use({ trace: "off" });
test.setTimeout(90000);
test("real owner articles and all list rows use only published or pending", async ({
  page,
}, info) => {
  const base = process.env.E2E_BASE_URL!;
  expect(base).toBe("https://campusos-preview.zhujunkui1.workers.dev");
  const report = JSON.parse(
    readFileSync(
      "docs/verification/two-state-2026-10-20/owner-publication.json",
      "utf8",
    ),
  );
  expect(report.complete).toBe(true);
  const secret = JSON.parse(
    readFileSync(".map-tools/s3-a/preview-secrets.json", "utf8"),
  );
  const dir = process.env.SOURCE_SYNC_EVIDENCE_DIR!;
  mkdirSync(dir, { recursive: true });
  await page.goto("/admin");
  await page
    .getByLabel("管理员访问密钥", { exact: true })
    .fill(previewConsoleCredential(secret));
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "内容运营总览", exact: true }),
  ).toBeVisible();
  for (const target of report.targets) {
    await page.goto(
      `/admin/sources?record=${target.sourceId}&article=${target.id}`,
    );
    await expect(page.locator(".console-badge")).toHaveText([
      "已发布",
      "已发布",
    ]);
    expect(
      (await page.request.get("/api/public/content?id=" + target.id)).status(),
    ).toBe(200);
  }
  await page.goto(
    "/admin/sources?record=GDUFS-SRC-0008&article=content-76b1fc0b-ace5-4db2-bb5f-b029dd771d78",
  );
  await expect(page.locator(".console-badge")).toHaveText(["待审核", "待审核"]);
  expect(
    (
      await page.request.get(
        "/api/public/content?id=content-76b1fc0b-ace5-4db2-bb5f-b029dd771d78",
      )
    ).status(),
  ).toBe(404);
  await expect(
    page.getByRole("button", { name: "发布", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-article.png`,
    fullPage: true,
  });
  await page.goto("/admin/reviews");
  await expect(page.locator(".console-source-row").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "批量发布", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "批量撤回", exact: true }),
  ).toBeVisible();
  for (const name of ["批量批准", "批量拒绝", "批量退回"])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  for (const status of await page
    .locator(".console-source-row > span")
    .allTextContents())
    expect(["已发布", "待审核"]).toContain(status.trim());
  await page.getByText("筛选与排序", { exact: true }).click();
  const state = page.getByRole("combobox", { name: "状态", exact: true });
  await expect(state.locator("option")).toHaveText([
    "全部",
    "已发布",
    "待审核",
  ]);
  await state.selectOption("pending");
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect(page.locator(".console-source-row > span")).toHaveText([
    "待审核",
    "待审核",
  ]);
  await expect(
    page.locator(
      '.console-source-row[href*="content-2a1a1c4e-0833-4186-afa6-e7696982513b"]',
    ),
  ).toBeVisible();
  expect(
    (
      await page.request.get(
        "/api/public/content?id=content-2a1a1c4e-0833-4186-afa6-e7696982513b",
      )
    ).status(),
  ).toBe(404);
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-pending-list.png`,
    fullPage: true,
  });
  await page
    .getByRole("combobox", { name: "状态", exact: true })
    .selectOption("published");
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect(page.locator(".console-source-row").first()).toBeVisible();
  await expect(page.locator(".console-source-row > span").first()).toHaveText(
    "已发布",
  );
  for (const status of await page
    .locator(".console-source-row > span")
    .allTextContents())
    expect(status.trim()).toBe("已发布");
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-published-list.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "安全退出", exact: true }).click();
});

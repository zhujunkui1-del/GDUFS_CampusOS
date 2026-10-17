import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
test.skip(
  process.env.INGESTION_PREVIEW_E2E !== "1",
  "Explicit real preview metadata acceptance only",
);
test("real cloud drafts retain original dates, metadata rights and review state", async ({
  page,
}, info) => {
  const base = "https://campusos-preview.zhujunkui1.workers.dev";
  expect(process.env.E2E_BASE_URL).toBe(base);
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
  const auth = (await (await page.request.get("/api/console-auth")).json())
    .data;
  try {
    const content = (
      await (await page.request.get("/api/admin/content")).json()
    ).data.items;
    const library = content.find(
      (d: { sourceId: string }) => d.sourceId === "GDUFS-SRC-0008",
    );
    expect(library).toBeTruthy();
    const reply = await page.request.get("/api/admin/content/" + library.id);
    expect(reply.headers()["cache-control"]).toContain("no-store");
    const d = (await reply.json()).data;
    expect(d).toMatchObject({
      publishedAt: "2026-06-30",
      sourceUpdatedAt: null,
      rightsScope: "metadata_only",
      reviewStatus: "pending",
      publicationStatus: "draft",
      contentRevision: 1,
      body: "仅登记公开元数据，未保存第三方正文。",
    });
    expect(Date.parse(d.fetchedAt)).toBeGreaterThan(Date.parse(d.publishedAt));
    await page.goto("/admin/content?record=" + encodeURIComponent(d.id));
    await expect(
      page.getByRole("heading", { name: d.title, exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("combobox", { name: "知识分类", exact: true })
        .locator("option"),
    ).toHaveCount(7);
    await expect(
      page
        .getByRole("combobox", { name: "雷达分类", exact: true })
        .locator("option"),
    ).toHaveCount(8);
    await expect(
      page.getByLabel("原文发布时间（北京时间）", { exact: true }),
    ).toHaveAttribute("type", "date");
    await expect(
      page.getByLabel("原文发布时间（北京时间）", { exact: true }),
    ).toHaveValue("2026-06-30");
    const dir = "docs/verification/s3-b/browser";
    mkdirSync(dir, { recursive: true });
    const prefix = `${dir}/ingestion-preview-${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}`;
    await page.screenshot({ path: prefix + "-content.png", fullPage: true });
    await page.goto("/admin/jobs");
    await expect(
      page.getByRole("heading", { name: "采集任务", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".console-job").first()).toContainText("已完成");
    await page.screenshot({ path: prefix + "-jobs.png", fullPage: true });
  } finally {
    await page.request.delete("/api/console-auth", {
      headers: { Origin: base, "X-Console-CSRF": auth.csrf },
    });
  }
});

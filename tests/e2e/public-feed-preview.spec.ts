import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { previewConsoleCredential } from "./helpers/console-credential";
test.skip(
  process.env.SOURCE_SYNC_PUBLIC_E2E !== "1",
  "Explicit read-only existing preview verification",
);
test.use({ trace: "off" });
test.setTimeout(90000);
test("five real official sources are anonymously visible on radar and knowledge", async ({
  page,
  request,
}, info) => {
  const base = process.env.E2E_BASE_URL!;
  expect(base).toBe("https://campusos-preview.zhujunkui1.workers.dev");
  const run = JSON.parse(
    readFileSync(
      "docs/verification/source-sync-2026-10-19/sync-results.json",
      "utf8",
    ),
  );
  expect(run.complete).toBe(true);
  const expected: string[] = run.sources.flatMap(
    (s: { records: { id: string; published: boolean }[] }) =>
      s.records.filter((r) => r.published).map((r) => r.id),
  );
  const old: string[] = run.sources.flatMap(
    (s: { skipped: { id: string }[] }) => s.skipped.map((r) => r.id),
  );
  const dir =
    process.env.SOURCE_SYNC_EVIDENCE_DIR ||
    "docs/verification/source-sync-2026-10-19/cloud-browser";
  mkdirSync(dir, { recursive: true });
  for (const surface of ["radar", "knowledge"]) {
    const ids: string[] = [];
    let offset = 0,
      more = true;
    while (more && offset <= 200) {
      const r = await request.get(
        `/api/public/content?surface=${surface}&limit=20&offset=${offset}`,
      );
      expect(r.status()).toBe(200);
      const data = (await r.json()).data;
      ids.push(...data.items.map((x: { id: string }) => x.id));
      expect(data.items.some((x: object) => "body" in x)).toBe(false);
      more = data.hasMore;
      offset += 20;
    }
    expect(expected.every((id) => ids.includes(id))).toBe(true);
    expect(old.some((id) => ids.includes(id))).toBe(false);
    await page.goto("/" + surface);
    await expect(
      page.getByRole("heading", {
        name: surface === "radar" ? "校园雷达" : "校园知识",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".public-feed-card").first()).toBeVisible();
    await page.screenshot({
      path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-${surface}.png`,
      fullPage: true,
    });
    if (expected.length > 12) {
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      await expect(page.getByText("第 2 页", { exact: true })).toBeVisible();
      await expect(page.locator(".public-feed-card").first()).toBeVisible();
      await page.getByRole("button", { name: "上一页", exact: true }).click();
    }
    const category = surface === "radar" ? "讲座" : "办事服务";
    await page.getByRole("button", { name: category, exact: true }).click();
    await expect(page.locator(".public-feed-card").first()).toBeVisible();
    await expect(
      page.locator(".public-feed-card").first().locator(".public-feed-meta"),
    ).toContainText(category);
    await page.getByRole("button", { name: "全部", exact: true }).click();
    await page.getByLabel("来源名称", { exact: true }).fill("图书馆");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.locator(".public-feed-card").first()).toContainText(
      "图书馆",
    );
    for (const row of await page.locator(".public-feed-card").all())
      await expect(row.locator(".public-feed-meta")).toContainText("图书馆");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  }
  for (const id of old)
    expect((await request.get("/api/public/content?id=" + id)).status()).toBe(
      404,
    );
  await page.goto("/admin");
  const secrets = JSON.parse(
    readFileSync(".map-tools/s3-a/preview-secrets.json", "utf8"),
  );
  await page
    .getByLabel("管理员访问密钥", { exact: true })
    .fill(previewConsoleCredential(secrets));
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "内容运营总览", exact: true }),
  ).toBeVisible();
  const sync = page.getByRole("button", {
    name: "立即检查到期来源",
    exact: true,
  });
  await expect(sync).toHaveCSS("background-color", "rgb(18, 97, 187)");
  await expect(sync).toHaveCSS("color", "rgb(255, 255, 255)");
  expect(
    await sync.evaluate((el) => el.previousElementSibling?.textContent),
  ).toMatch(/暂停自动同步|恢复自动同步/);
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-dashboard.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "安全退出", exact: true }).click();
});

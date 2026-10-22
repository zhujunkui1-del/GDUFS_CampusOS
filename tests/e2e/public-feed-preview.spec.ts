import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
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
  const classified = JSON.parse(
    readFileSync(
      "docs/verification/article-ui-2026-10-19/classification-results.json",
      "utf8",
    ),
  );
  expect(classified.complete).toBe(true);
  const allIds: Record<string, string[]> = {};
  // D-054: only explicit owner publication receipts release historical withdrawals.
  const ownerFile =
    "docs/verification/two-state-2026-10-20/owner-publication.json";
  const owner = existsSync(ownerFile)
    ? JSON.parse(readFileSync(ownerFile, "utf8"))
    : null;
  const released: string[] = owner?.complete
    ? owner.targets.map((r: { id: string }) => r.id)
    : [];
  const old: string[] = run.sources.flatMap(
    (s: { skipped: { id: string }[] }) =>
      s.skipped.filter((r) => !released.includes(r.id)).map((r) => r.id),
  );
  const dir =
    process.env.SOURCE_SYNC_EVIDENCE_DIR ||
    "docs/verification/source-sync-2026-10-19/cloud-browser";
  mkdirSync(dir, { recursive: true });
  for (const surface of ["radar", "knowledge"]) {
    const expected = classified.records
      .filter(
        (r: {
          radarCategory: string | null;
          knowledgeCategory: string | null;
        }) => (surface === "radar" ? r.radarCategory : r.knowledgeCategory),
      )
      .map((r: { id: string }) => r.id);
    const ids: string[] = [];
    let expectedTotal = 0;
    let offset = 0,
      more = true;
    while (more && offset <= 200) {
      const r = await request.get(
        `/api/public/content?surface=${surface}&limit=20&offset=${offset}`,
      );
      expect(r.status()).toBe(200);
      const data = (await r.json()).data;
      ids.push(...data.items.map((x: { id: string }) => x.id));
      expectedTotal = data.total;
      expect(
        Object.values(data.counts).reduce((a: number, n) => a + Number(n), 0),
      ).toBe(data.total);
      expect(data.items.some((x: object) => "body" in x)).toBe(false);
      more = data.hasMore;
      offset += 20;
    }
    allIds[surface] = ids;
    expect(ids.length).toBe(expectedTotal);
    expect(expected.every((id: string) => ids.includes(id))).toBe(true);
    expect(old.some((id) => ids.includes(id))).toBe(false);
    await page.goto("/" + surface);
    await expect(page.locator(".module-heading-title")).toContainText(
      surface === "radar" ? "校园雷达" : "校园知识",
    );
    await expect(page.locator(".public-feed-card").first()).toBeVisible();
    if (info.project.name === "desktop") {
      const gaps = async (rightSelector?: string) => {
        await expect
          .poll(async () => {
            const feed = await page.locator(".public-feed").boundingBox(),
              nav = await page.locator(".sidebar").boundingBox();
            const right = rightSelector
              ? (await page.locator(rightSelector).boundingBox())!.x
              : page.viewportSize()!.width;
            return Math.abs(
              feed!.x - nav!.x - nav!.width - (right - feed!.x - feed!.width),
            );
          })
          .toBeLessThanOrEqual(1);
      };
      await gaps();
      await page.getByRole("button", { name: "展开导航", exact: true }).click();
      await expect(page.locator(".campus-shell")).toHaveClass(/nav-expanded/);
      await gaps();
      await page.getByRole("button", { name: "收起导航", exact: true }).click();
      await page
        .getByRole("button", { name: "打开校园助理", exact: true })
        .click();
      await expect(page.locator(".assistant-panel")).toBeVisible();
      await gaps(".assistant-viewport");
      await page
        .getByRole("button", { name: "收起校园助理", exact: true })
        .click();
      await expect(page.locator(".assistant-panel")).toBeHidden();
    }
    await page.screenshot({
      path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-${surface}.png`,
      fullPage: true,
    });
    await expect(
      page.locator(".public-feed-categories button").first(),
    ).toHaveText("全部" + ids.length);
    await expect(page.locator(".public-feed-meta")).toHaveCount(0);
    for (const columns of [1, 2, 3, 4]) {
      await page.getByLabel("每行文章数量").selectOption(String(columns));
      const tracks = await page
        .locator(".public-feed-group-list")
        .evaluate(
          (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
        );
      expect(tracks).toBe(info.project.name === "mobile" ? 1 : columns);
    }
    await page.getByLabel("每行文章数量").selectOption("1");
    if (ids.length > 12) {
      await page
        .locator(".public-feed-group .public-feed-more")
        .first()
        .click();
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      await expect(page.locator(".public-feed-pagination")).toContainText(
        "第 2 页",
      );
      await expect(page.locator(".public-feed-card").first()).toBeVisible();
      await page.getByRole("button", { name: "上一页", exact: true }).click();
    }
    const category = surface === "radar" ? "讲座" : "校园生活";
    await page
      .getByRole("button", { name: new RegExp("^" + category + "\\s*[0-9]+$") })
      .click();
    await expect(page.locator(".public-feed-card").first()).toBeVisible();
    await expect(page.locator(".public-feed-toolbar > h2")).toContainText(
      category,
    );
    await page.getByRole("button", { name: /^全部\s*[0-9]+$/ }).click();
    await page.getByLabel("搜索来源名称", { exact: true }).fill("图书馆");
    await expect(page.locator(".public-feed-source").first()).toContainText(
      "图书馆",
    );
    for (const row of await page.locator(".public-feed-card").all())
      await expect(row.locator(".public-feed-source")).toContainText("图书馆");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  }
  expect(allIds.radar.some((id) => allIds.knowledge.includes(id))).toBe(false);
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
    name: "立即同步",
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
  const first = classified.records[0];
  await page.goto(
    "/admin/sources?record=" + first.sourceId + "&article=" + first.id,
  );
  await expect(
    page.getByRole("link", { name: "加入白名单", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "一级分类", exact: true }),
  ).toHaveValue(first.radarCategory ? "radar" : "knowledge");
  for (const label of [
    "查找信息源",
    "候选用途",
    "使用范围",
    "发布机构",
    "原文更新时间",
    "原文发布时间（北京时间）",
  ])
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  for (const name of ["批准", "退回", "拒绝"])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  await expect(page.getByText("完整性检查", { exact: true })).toHaveCount(0);
  await expect(page.getByText("版本记录", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-article.png`,
    fullPage: true,
  });
  await page.goto("/admin/reviews");
  await page.getByText("筛选与排序", { exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "状态", exact: true }).locator("option"),
  ).toHaveText(["全部", "已发布", "待审核"]);
  for (const label of [
    "公开状态",
    "发布止日",
    "发现起日",
    "发现止日",
    "生命周期",
    "严重程度",
    "问题类型",
  ])
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  await page.goto("/admin/retention");
  const heading = page.getByRole("heading", {
    name: "过时信息清理",
    exact: true,
  });
  await expect(heading).toHaveCSS("font-weight", "600");
  expect(
    await heading.evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain("Microsoft YaHei");
  await expect(
    page.getByText("当前环境永久清理未授权", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "恢复计划", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: `${dir}/${process.env.PLAYWRIGHT_CHANNEL}-${info.project.name}-retention.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "安全退出", exact: true }).click();
});

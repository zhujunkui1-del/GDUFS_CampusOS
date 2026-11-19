import { expect, test } from "@playwright/test";
test("article publication toggle submits versioned commands outside the article link", async ({
  page,
}) => {
  let published = true,
    version = 4;
  const calls: unknown[] = [];
  let radarCategory: string | null = null;
  let knowledgeCategory: string | null = "administrative_services";
  await page.route("**/api/console-auth", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          authenticated: true,
          mode: "local",
          environment: "local",
          csrf: "fixture-csrf",
          actor: {
            id: "fixture",
            email: "fixture@example.invalid",
            role: "admin",
          },
        },
      },
    }),
  );
  await page.route("**/api/admin/v2/hotspots", (route) =>
    route.fulfill({ json: { ok: true, data: { items: [] } } }),
  );
  await page.route("**/api/admin/v2/articles?*", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          offset: 0,
          total: 1,
          limit: 20,
          items: [
            {
              id: "fixture-article",
              source_id: "fixture-source",
              source_name: "隔离来源",
              title: "隔离测试文章",
              published_at: "2026-11-19",
              publication_state: published ? "published" : "pending",
              version,
            },
          ],
        },
      },
    }),
  );
  await page.route(
    /\/api\/admin\/content\/fixture-article\/(?:publish|withdraw)$/,
    (route) => {
      expect(route.request().postDataJSON().expectedVersion).toBe(version);
      calls.push(new URL(route.request().url()).pathname.split("/").at(-1));
      published = !published;
      version++;
      return route.fulfill({ json: { ok: true, data: {} } });
    },
  );
  await page.route("**/api/admin/v2/sources/fixture-source", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          id: "fixture-source",
          version: 1,
          displayName: "隔离来源",
          organization: "隔离机构",
          sourceType: "wechat_subscription",
          enabled: true,
          websiteUrl: null,
        },
      },
    }),
  );
  await page.route("**/api/admin/content/fixture-article", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          id: "fixture-article",
          sourceId: "fixture-source",
          sourceName: "隔离来源",
          title: "隔离测试文章",
          publishedAt: "2026-11-19",
          fetchedAt: "2026-11-19",
          url: "https://example.invalid/article",
          collectionManaged: true,
          radarCategory,
          knowledgeCategory,
          version,
          publicationState: published ? "published" : "withdrawn",
        },
      },
    }),
  );
  await page.route("**/api/admin/v2/classify/fixture-article", (route) => {
    const change = route.request().postDataJSON();
    expect(change).toMatchObject({
      expectedVersion: version,
      radarCategory: "lecture",
      knowledgeCategory: null,
    });
    radarCategory = change.radarCategory;
    knowledgeCategory = change.knowledgeCategory;
    version++;
    return route.fulfill({ json: { ok: true, data: {} } });
  });
  await page.goto("/admin/articles");
  const row = page
    .locator(".console-v2-select-row")
    .filter({ hasText: "隔离测试文章" });
  const toggle = row.locator(".console-publication-toggle");
  await expect(toggle).toHaveText("已发布");
  await expect(toggle).toHaveCSS("color", "rgb(255, 255, 255)");
  await toggle.click();
  await expect(toggle).toHaveText("未发布");
  await expect(toggle).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await toggle.click();
  await expect(toggle).toHaveText("已发布");
  expect(calls).toEqual(["withdraw", "publish"]);
  await expect(page).toHaveURL(/\/admin\/articles$/);
  await page.goto("/admin/sources?record=fixture-source");
  await expect(toggle).toHaveText("已发布");
  await toggle.click();
  await expect(toggle).toHaveText("未发布");
  await row.getByRole("link", { name: /隔离测试文章/ }).click();
  const detailToggle = page.locator(
    ".console-actions .console-publication-toggle",
  );
  await expect(detailToggle).toHaveText("未发布");
  await expect(
    page.getByRole("link", { name: "采集设置", exact: true }),
  ).toHaveCount(0);
  await detailToggle.click();
  await expect(detailToggle).toHaveText("已发布");
  expect(calls).toEqual(["withdraw", "publish", "withdraw", "publish"]);
  await expect(
    page.getByRole("combobox", { name: "栏目", exact: true }),
  ).toHaveValue("knowledge");
  await page
    .getByRole("combobox", { name: "栏目", exact: true })
    .selectOption("radar");
  await page
    .getByRole("combobox", { name: "标签", exact: true })
    .selectOption("lecture");
  await page.getByRole("button", { name: "保存分类", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已保存" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "标签", exact: true }),
  ).toHaveValue("lecture");
  await expect(detailToggle).toHaveText("已发布");
});

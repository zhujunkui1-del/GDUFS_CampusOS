import { expect, test } from "@playwright/test";

const detail = {
  id: "fixture-manual",
  sourceId: "fixture-source",
  sourceName: "隔离来源",
  title: "隔离测试文章",
  kind: "knowledge",
  version: 3,
  reviewStatus: "pending",
  publicationStatus: "withdrawn",
  publicationState: "pending",
  url: "https://example.invalid/manual",
  validUntil: null,
  collectionManaged: false,
  body: "仅登记公开元数据，未保存第三方正文。",
  bodyFormat: "plain",
  bodyStatus: "not_provided",
  campusScope: "all",
  contentType: "guide",
  rightsScope: "licensed_full_text",
  discoveries: [],
  timeEvidence: [],
  extractedFields: {},
  publishedAt: "2026-11-19",
  fetchedAt: "2026-11-19",
  sourceUpdatedAt: null,
  updatedAt: null,
  publisher: null,
  summary: null,
  tags: [],
  radarCategory: null,
  knowledgeCategory: "administrative_services",
};

test("manual article exposes a red delete button right of withdraw that submits a DELETE command", async ({
  page,
}) => {
  const calls: { method: string; path: string; body: unknown }[] = [];
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
              id: "fixture-manual",
              source_id: "fixture-source",
              source_name: "隔离来源",
              title: "隔离测试文章",
              published_at: "2026-11-19",
              publication_state: "pending",
              version: 3,
            },
          ],
        },
      },
    }),
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
          sourceType: "manual",
          enabled: true,
          websiteUrl: null,
        },
      },
    }),
  );
  await page.route("**/api/admin/content/fixture-manual", (route) => {
    calls.push({
      method: route.request().method(),
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON(),
    });
    return route.request().method() === "DELETE"
      ? route.fulfill({ json: { ok: true, data: {} } })
      : route.fulfill({ json: { ok: true, data: detail } });
  });

  await page.goto(
    "/admin/sources?record=fixture-source&article=fixture-manual",
  );

  const actions = page.locator(".console-actions");
  const remove = actions.getByRole("button", { name: "删除", exact: true });
  const withdraw = actions.getByRole("button", { name: "撤回", exact: true });
  await expect(remove).toBeVisible();
  await expect(remove).toHaveCSS("background-color", "rgb(180, 35, 24)");
  await expect(remove).toHaveCSS("color", "rgb(255, 255, 255)");
  const withdrawBox = (await withdraw.boundingBox())!;
  const removeBox = (await remove.boundingBox())!;
  expect(removeBox.x).toBeGreaterThan(withdrawBox.x + withdrawBox.width - 1);
  const statusCard = page
    .locator("section.console-card")
    .filter({ has: page.getByRole("heading", { name: "发布状态" }) });
  await statusCard.scrollIntoViewIfNeeded();
  await statusCard.screenshot({
    path: "test-results/console-content-delete.png",
  });

  await remove.click();
  const confirm = page.locator(".conversation-confirm");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("删除这篇文章？");
  await expect(confirm).toContainText("历史版本与操作记录保留。");
  await confirm.locator(".conversation-danger").click();

  await expect(page).toHaveURL(/\/admin\/articles$/);
  const deletes = calls.filter((call) => call.method === "DELETE");
  expect(deletes).toHaveLength(1);
  expect(deletes[0].path).toBe("/api/admin/content/fixture-manual");
  expect(deletes[0].body).toMatchObject({ expectedVersion: 3 });
});

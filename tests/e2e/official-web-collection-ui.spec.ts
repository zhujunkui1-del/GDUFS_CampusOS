import { test, expect } from "@playwright/test";

const source = {
  id: "GDUFS-SRC-0012",
  displayName: "广东外语外贸大学",
  websiteUrl: "https://www.gdufs.edu.cn/",
  enabled: true,
  operatingStatus: "active",
  verificationStatus: "verified",
  officialStatus: "verified_official",
  permissionStatus: "unreviewed",
  authorizationStatus: "unreviewed",
  version: 4,
  profileConfigured: true,
  entryUrls: [
    "https://www.gdufs.edu.cn/xkky/rdjz.htm",
    "https://www.gdufs.edu.cn/tzgg.htm",
  ],
  articlePathPrefixes: ["/info/1005/", "/info/1004/"],
  profile: {
    configurationStatus: "discovered" as const,
    titleSelector: "head > title",
    titleSuffix: "-广东外语外贸大学",
    dateSelector: "span",
    dateLabel: "发布时间",
    bodySelector: ".v_news_content",
    allowQueryUrls: false,
    requestIntervalMs: 1000,
  },
  automatic: false,
  policyReady: false,
  policyRule: "official-web-test.1",
  policyExpires: 1792800000000,
  rightsScope: "metadata_only",
  lastSuccessAt: "2026-10-22T08:00:00.000Z",
  lastExecutor: "cloud" as const,
  nextSyncAt: 1792800000000,
  syncState: "completed",
  lastError: null,
};

test("官网采集模块集中显示入口与状态，所有官网使用统一间隔", async ({
  page,
}) => {
  let globalHours = 24,
    automatic = true,
    entryUrls = [...source.entryUrls];
  const searchTerms: string[] = [],
    manualRuns: Array<{ sourceId?: string; commandId: string }> = [];
  await page.route("**/api/console-auth", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          authenticated: true,
          mode: "local",
          environment: "local",
          csrf: "fixture-csrf",
          actor: {
            id: "fixture-admin",
            email: "admin@example.invalid",
            role: "admin",
          },
        },
      }),
    }),
  );
  await page.route("**/api/admin/v2/web-collection**", async (route) => {
    const url = new URL(route.request().url());
    searchTerms.push(url.searchParams.get("q") || "");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          items: [{ ...source, entryUrls }],
          total: 109,
          allTotal: 109,
          configuredTotal: 73,
          readiness: {
            candidateTotal: 73,
            missingProfileTotal: 21,
            policyPendingTotal: 0,
            sourcePendingTotal: 0,
            activeJobTotal: 0,
            readyTotal: 0,
          },
          offset: Number(url.searchParams.get("offset") || 0),
          limit: Number(url.searchParams.get("limit") || 50),
          settings: {
            version: 1,
            sync_hours: globalHours,
            auto_sync_enabled: Number(automatic),
            earliest_import_day: null,
            runner_last_at: "2026-10-23T01:00:00.000Z",
            scheduler_last_at: "2026-10-23T01:00:00.000Z",
            cloud_runner_last_at: "2026-10-23T01:00:00.000Z",
          },
        },
      }),
    });
  });
  await page.route("**/api/admin/v2/sync", async (route) => {
    const body = route.request().postDataJSON() as {
      sourceId?: string;
      commandId: string;
    };
    manualRuns.push(body);
    const isFirstGlobalAttempt =
      !body.sourceId && manualRuns.filter((run) => !run.sourceId).length === 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: isFirstGlobalAttempt
          ? { registered: 0, completed: 0, state: "busy", retryAfterMs: 10 }
          : { registered: 0, completed: 0, state: "no_eligible_due_source" },
      }),
    });
  });
  await page.route("**/api/admin/v2/settings", async (route) => {
    const body = route.request().postDataJSON() as {
      syncHours?: number;
      autoSync?: boolean;
    };
    if (body.syncHours) globalHours = body.syncHours;
    if (body.autoSync != null) automatic = body.autoSync;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { saved: true } }),
    });
  });
  await page.route(
    "**/api/admin/v2/web-collection/GDUFS-SRC-0012/profile",
    async (route) => {
      const body = route.request().postDataJSON() as {
        entryUrls: string[];
        configurationStatus: string;
      };
      expect(body.configurationStatus).toBe("discovered");
      entryUrls = body.entryUrls;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { saved: true } }),
      });
    },
  );
  await page.route(
    "**/api/admin/sources/GDUFS-SRC-0012/collection-policy",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            profile: {
              ruleVersion: "official-web-test.1",
              origin: "https://www.gdufs.edu.cn",
            },
            policy: {
              rights_scope: "metadata_only",
              expires_at_ms: 1792800000000,
            },
          },
        }),
      }),
  );

  await page.goto("/admin/web-collection");
  await expect(
    page.getByRole("heading", { name: "官网采集", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("全站已配置入口 73 / 109 个官网", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/云端执行器/)).toBeVisible();
  await expect(page.getByText("最近任务", { exact: true })).toHaveCount(0);
  await expect(page.getByText("执行器授权", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("栏目入口与解析规则", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(1);
  await expect(page.getByText("2 个候选入口", { exact: true })).toBeVisible();
  await expect(page.getByText("待核对规则", { exact: true })).toBeVisible();
  await expect(page.locator(".console-web-search > svg")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "搜索", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".console-web-source-row")
      .getByRole("button", { name: "立即采集", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("搜索官网", { exact: true }).fill("广东");
  await expect.poll(() => searchTerms.at(-1), { timeout: 4000 }).toBe("广东");
  await page.getByLabel("清除搜索", { exact: true }).click();
  await expect.poll(() => searchTerms.at(-1), { timeout: 4000 }).toBe("");
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "暂停自动采集", exact: true }),
  ).toBeVisible();
  if (test.info().project.name === "desktop")
    await page.screenshot({
      path: test.info().outputPath("official-web-collection-local.png"),
      fullPage: true,
    });
  if (test.info().project.name === "desktop") {
    const cadence = await page
        .getByRole("combobox", { name: /统一采集间隔/ })
        .boundingBox(),
      saveButton = await page
        .getByRole("button", { name: "保存", exact: true })
        .boundingBox(),
      pauseButton = await page
        .getByRole("button", { name: "暂停自动采集", exact: true })
        .boundingBox(),
      collectButton = await page
        .locator(".console-web-global-controls")
        .getByRole("button", { name: "立即采集", exact: true })
        .boundingBox();
    expect(cadence && saveButton && pauseButton && collectButton).toBeTruthy();
    expect(
      Math.abs(
        cadence!.y +
          cadence!.height / 2 -
          (saveButton!.y + saveButton!.height / 2),
      ),
    ).toBeLessThan(18);
    expect(saveButton!.x - (cadence!.x + cadence!.width)).toBeLessThan(24);
    expect(
      Math.abs(
        saveButton!.y +
          saveButton!.height / 2 -
          (pauseButton!.y + pauseButton!.height / 2),
      ),
    ).toBeLessThan(2);
    expect(pauseButton!.x - (saveButton!.x + saveButton!.width)).toBeLessThan(
      24,
    );
    expect(
      Math.abs(
        pauseButton!.y +
          pauseButton!.height / 2 -
          (collectButton!.y + collectButton!.height / 2),
      ),
    ).toBeLessThan(2);
    expect(
      collectButton!.x - (pauseButton!.x + pauseButton!.width),
    ).toBeLessThan(24);
  }
  await page.getByRole("button", { name: "配置入口", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /文章栏目入口/ })).toHaveValue(
    source.entryUrls.join("\n"),
  );
  await expect(page.getByRole("textbox", { name: /文章路径前缀/ })).toHaveValue(
    source.articlePathPrefixes.join("\n"),
  );
  await page
    .getByRole("textbox", { name: /文章栏目入口/ })
    .fill([...source.entryUrls, "https://www.gdufs.edu.cn/xwzx/"].join("\n"));
  await page.getByRole("button", { name: "保存采集规则", exact: true }).click();
  await expect(
    page.getByText("入口规则已保存；访问许可需重新核对", { exact: true }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: /统一采集间隔/ }).selectOption("6");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已保存统一间隔", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: /统一采集间隔/ }),
  ).toHaveValue("6");
  await expect(page.getByRole("combobox")).toHaveCount(1);
  await page.getByRole("button", { name: "暂停自动采集", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "恢复自动采集", exact: true }),
  ).toBeVisible();
  const sourceRow = page.locator(".console-web-source-row");
  await sourceRow
    .getByRole("button", { name: "立即采集", exact: true })
    .click();
  await expect(sourceRow.locator(".console-web-source-message")).toContainText(
    "入口仍是候选，先核对栏目和解析规则并保存",
  );
  expect(manualRuns.at(-1)?.sourceId).toBe(source.id);
  await page
    .locator(".console-web-global-controls")
    .getByRole("button", { name: "立即采集", exact: true })
    .click();
  await expect(
    page.getByText("未登记任务：21 个未配置入口；73 个入口待核对", {
      exact: true,
    }),
  ).toBeVisible();
  const globalRuns = manualRuns.filter((run) => !run.sourceId);
  expect(globalRuns).toHaveLength(2);
  expect(globalRuns[0].commandId).toBe(globalRuns[1].commandId);
});

test("信息源列表将文章数量紧凑排列在行尾", async ({ page }) => {
  await page.route("**/api/console-auth", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          authenticated: true,
          mode: "local",
          environment: "local",
          csrf: "fixture-csrf",
          actor: {
            id: "fixture-admin",
            email: "admin@example.invalid",
            role: "admin",
          },
        },
      }),
    }),
  );
  await page.route("**/api/admin/v2/sources**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          items: [
            {
              id: "official-web-layout-fixture",
              displayName: "亚洲大学校长论坛",
              sourceType: "official_web",
              organization: "校级/专题服务",
              enabled: true,
              collectorEnabled: null,
              protected: false,
              articleCount: 0,
              publishedCount: 0,
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
        },
      }),
    }),
  );
  await page.goto("/admin/sources");
  const row = page.locator(".console-v2-source");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("亚洲大学校长论坛");
  const rowBox = await row.boundingBox(),
    countsBox = await row.locator(".console-v2-source-counts").boundingBox();
  expect(rowBox && countsBox).toBeTruthy();
  if (test.info().project.name === "desktop")
    expect(countsBox!.x).toBeGreaterThan(rowBox!.x + rowBox!.width * 0.65);
  else
    expect(countsBox!.x + countsBox!.width).toBeGreaterThan(
      rowBox!.x + rowBox!.width * 0.7,
    );
  expect(countsBox!.x + countsBox!.width).toBeLessThanOrEqual(
    rowBox!.x + rowBox!.width - 8,
  );
  expect(rowBox!.height).toBeLessThan(
    test.info().project.name === "desktop" ? 110 : 170,
  );
});

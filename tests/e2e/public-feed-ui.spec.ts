import { test, expect } from "@playwright/test";

type MockItem = {
  id: string;
  version: number;
  title: string;
  url: string;
  readable: boolean;
  publishedAt: string;
  contentType: string;
  knowledgeCategory: string | null;
  radarCategory: string | null;
  source: { name: string; official: boolean };
};

const radarCategories = [
  { code: "lecture", label: "讲座" },
  { code: "culture_sports", label: "文体活动" },
  { code: "competition", label: "竞赛" },
  { code: "education_career", label: "升学就业" },
  { code: "academic_research", label: "学术科研" },
  { code: "scholarship_opportunity", label: "奖助机会" },
  { code: "campus_notice", label: "校园公告" },
];
const knowledgeCategories = [
  { code: "academic_affairs", label: "学业教务" },
  { code: "campus_life", label: "校园生活" },
  { code: "administrative_services", label: "办事服务" },
  { code: "scholarship_policy", label: "奖助政策" },
  { code: "education_career", label: "升学就业" },
  { code: "research_innovation", label: "科研创新" },
];

function makeItem(
  id: string,
  title: string,
  surface: "radar" | "knowledge",
  category: string,
  source: string,
): MockItem {
  return {
    id,
    version: 1,
    title,
    url: `https://mp.weixin.qq.com/s/${id.padEnd(20, "x")}`,
    readable: true,
    publishedAt: "2026-10-22T06:56:48.000Z",
    contentType: surface === "radar" ? "notice" : "guide",
    knowledgeCategory: surface === "knowledge" ? category : null,
    radarCategory: surface === "radar" ? category : null,
    source: { name: source, official: false },
  };
}

const radarItems = [
  ...Array.from({ length: 13 }, (_, index) =>
    makeItem(
      `lecture-${index}`,
      `讲座文章 ${String(index + 1).padStart(2, "0")}`,
      "radar",
      "lecture",
      "广外就业",
    ),
  ),
  makeItem("notice-1", "长征纪念通知", "radar", "campus_notice", "图书馆"),
];
const knowledgeItems = [
  makeItem("guide-1", "图书借阅指南", "knowledge", "campus_life", "图书馆"),
  makeItem("guide-2", "学习空间预约方法", "knowledge", "campus_life", "图书馆"),
];

test("radar and knowledge grouped feed, live search, and article dialog", async ({
  page,
}) => {
  await page.route("**/api/public/content?*", async (route) => {
    const url = new URL(route.request().url());
    const surface = url.searchParams.get("surface") as "radar" | "knowledge";
    const categories =
      surface === "radar" ? radarCategories : knowledgeCategories;
    const allItems = surface === "radar" ? radarItems : knowledgeItems;
    const titleQuery = (url.searchParams.get("q") || "").toLowerCase();
    const sourceQuery = (url.searchParams.get("source") || "").toLowerCase();
    const filtered = allItems.filter(
      (item) =>
        item.title.toLowerCase().includes(titleQuery) &&
        item.source.name.toLowerCase().includes(sourceQuery),
    );
    const counts = Object.fromEntries(
      categories.map((category) => [
        category.code,
        filtered.filter(
          (item) =>
            (surface === "radar"
              ? item.radarCategory
              : item.knowledgeCategory) === category.code,
        ).length,
      ]),
    );
    const total = filtered.length;
    let items: MockItem[] = [];
    let groups: Record<string, MockItem[]> | undefined;
    let hasMore = false;
    let nextCursor: string | null = null;
    const limit = Number(url.searchParams.get("limit") || 12);

    if (url.searchParams.get("grouped") === "1") {
      groups = Object.fromEntries(
        categories
          .filter((category) => counts[category.code] > 0)
          .map((category) => [
            category.code,
            filtered
              .filter(
                (item) =>
                  (surface === "radar"
                    ? item.radarCategory
                    : item.knowledgeCategory) === category.code,
              )
              .slice(0, limit),
          ]),
      );
      items = Object.values(groups).flat();
      hasMore = Object.values(counts).some((count) => count > limit);
    } else {
      const category = url.searchParams.get("category");
      const matched = filtered.filter(
        (item) =>
          (surface === "radar"
            ? item.radarCategory
            : item.knowledgeCategory) === category,
      );
      const start = url.searchParams.has("cursor") ? limit : 0;
      items = matched.slice(start, start + limit);
      hasMore = start + limit < matched.length;
      nextCursor = hasMore ? "next-page" : null;
    }
    await route.fulfill({
      json: {
        ok: true,
        data: { items, groups, hasMore, nextCursor, counts, total },
      },
    });
  });

  await page.route("**/api/public/article?*", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("id") || "";
    const article = [...radarItems, ...knowledgeItems].find(
      (item) => item.id === id,
    );
    await route.fulfill({
      json: {
        ok: true,
        data: {
          id,
          title: article?.title || "",
          url: article?.url || "",
          readingHtml: "<p>站内正文测试内容</p>",
          partial: false,
          publishedAt: article?.publishedAt || null,
          updatedAt: article?.publishedAt || "",
          sourceName: article?.source.name || "",
        },
      },
    });
  });

  for (const surface of ["radar", "knowledge"] as const) {
    await page.goto("/" + surface);
    const title = surface === "radar" ? "校园雷达" : "校园知识";
    await expect(page.locator(".module-heading-title")).toContainText(
      `广外通 CampusOS | ${title}`,
    );
    await expect(page.locator(".public-feed-group").first()).toBeVisible();
    await expect(page.locator(".public-feed-card").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "搜索", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".public-feed-refresh")).toBeVisible();
    const allTab = page.getByRole("button", { name: /^全部/ });
    const allTabCount = allTab.locator(".public-feed-count");
    await expect(allTabCount).toHaveText(surface === "radar" ? "14" : "2");
    expect(
      await page
        .locator(".public-feed-group")
        .first()
        .evaluate((group) =>
          (group as HTMLElement).style.getPropertyValue("--feed-accent"),
        ),
    ).toMatch(/^hsl\(/i);

    const firstCard = page.locator(".public-feed-card").first();
    await expect(firstCard).not.toContainText("摘要：");
    await expect(firstCard).toContainText("2026/10/22 14:56");
    await expect(firstCard).not.toContainText("14:56:48");
    await expect(firstCard.locator(".public-feed-source")).toContainText(
      surface === "radar" ? "广外就业" : "图书馆",
    );
    await expect(page.locator(".public-feed-meta")).toHaveCount(0);

    if (surface === "radar") {
      const groupColors = await page
        .locator(".public-feed-group")
        .evaluateAll((groups) =>
          groups.map((group) =>
            getComputedStyle(group).getPropertyValue("--feed-accent").trim(),
          ),
        );
      expect(new Set(groupColors).size).toBeGreaterThan(1);

      await page.getByRole("button", { name: /^校园公告/ }).click();
      await expect(allTabCount).toHaveText("14");
      await expect(page.locator(".public-feed-total")).toHaveText("1 篇");
      await allTab.click();

      await page
        .locator(".public-feed-group")
        .first()
        .getByRole("button", { name: "查看更多" })
        .click();
      await expect(page.locator(".public-feed-card")).toHaveCount(12);
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      await expect(page.locator(".public-feed-card")).toHaveCount(1);
      await page.getByRole("button", { name: /^全部/ }).click();
    } else {
      await page.getByRole("button", { name: /^科研创新/ }).click();
      await expect(allTabCount).toHaveText("2");
      await expect(page.locator(".public-feed-total")).toHaveText("0 篇");
      await allTab.click();
    }

    const pageUrl = page.url();
    await firstCard.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(pageUrl);
    await expect(page.locator(".public-article-summary")).toHaveCount(0);
    await expect(
      page.frameLocator(".article-reading-frame").locator("body"),
    ).toContainText("站内正文测试内容");
    await expect(
      page.getByRole("link", { name: "查看原文", exact: true }),
    ).toBeVisible();
    await page
      .locator(".public-article-dialog")
      .click({ position: { x: 4, y: 4 } });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await firstCard.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("button", { name: "关闭文章详情", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByLabel("搜索标题", { exact: true }).fill("纪念");
    if (surface === "radar") {
      await expect(page.locator(".public-feed-card")).toHaveCount(1);
      await expect(page.locator(".public-feed-card")).toContainText("长征");
    } else {
      await page.getByLabel("搜索标题", { exact: true }).fill("");
      await page.getByLabel("搜索来源名称", { exact: true }).fill("图书馆");
      await expect(page.locator(".public-feed-card")).toHaveCount(2);
      for (const card of await page.locator(".public-feed-card").all())
        await expect(card.locator(".public-feed-source")).toContainText(
          "图书馆",
        );
    }
  }

  for (const [path, title] of [
    ["schedule", "个人日程"],
    ["account", "我的账号"],
    ["favorites", "我的收藏"],
  ]) {
    await page.goto("/" + path);
    await expect(page.locator(".module-heading-title")).toContainText(
      `广外通 CampusOS | ${title}`,
    );
    await expect(page.locator(".module-heading-title > strong")).toHaveText(
      title,
    );
  }
});

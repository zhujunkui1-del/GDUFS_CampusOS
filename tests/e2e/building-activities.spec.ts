import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

test.skip(
  process.env.BUILDING_ACTIVITIES_E2E !== "1",
  "Local UI fixtures only",
);
test.setTimeout(60000);
test.use({ actionTimeout: 15000 });
const library = "osm-way-307250998";
test.beforeEach(async ({ page }) => {
  expect(new URL(process.env.E2E_BASE_URL!).hostname).toMatch(
    /^(127\.0\.0\.1|localhost)$/,
  );
  await page.route("**/api/public/activities?**", async (route) => {
    const q = new URL(route.request().url()).searchParams;
    expect(q.get("placeId")).toBe(library);
    const items = Array.from({ length: 7 }, (_, i) => ({
      eventId: "event-" + String(i).padStart(40, "0"),
      activity: {
        title: "隔离验收活动" + (i + 1),
        category: "lecture",
        placeRaw: "大学城校区图书馆",
        startsAt: { date: "2026-11-15", at: "2026-11-15T14:30:00+08:00" },
        endsAt: { date: "2026-11-15", at: "2026-11-15T16:00:00+08:00" },
      },
      sources: [
        {
          documentId: "fixture-activity-" + i,
          version: 1,
          title: "隔离验收活动" + (i + 1),
          originalUrl: "https://example.invalid/fixture",
          publishedAt: "2026-11-14",
          bodyAvailable: true,
          knowledgeCategory: null,
          source: { id: "fixture-source", name: "隔离测试来源" },
        },
      ],
    }));
    await route.fulfill({
      json: {
        ok: true,
        data: {
          items: q.has("cursor") ? items.slice(5) : items.slice(0, 5),
          total: 7,
          hasMore: !q.has("cursor"),
          nextCursor: q.has("cursor") ? null : "fixture-next",
        },
      },
    });
  });
  await page.route("**/api/public/article?id=fixture-activity-*", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: { readingHtml: "<p>仅用于本地隔离验收的活动正文。</p>" },
      },
    }),
  );
});

test("orders description, photos and five activities, opens more activities and its article, and preserves photos", async ({
  page,
}, info) => {
  await page.goto("/map");
  await page.getByRole("button", { name: "查看图书馆", exact: true }).click();
  const panel = page.locator(".place-details-panel");
  await expect(panel.locator(".building-activity-card")).toHaveCount(5);
  expect(
    await panel.evaluate((element) => {
      const desc = element.querySelector(".building-description")!,
        photos = element.querySelector(".building-photo-preview")!,
        activities = element.querySelector(".building-activities")!;
      return (
        !!(
          desc.compareDocumentPosition(photos) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ) &&
        !!(
          photos.compareDocumentPosition(activities) &
          Node.DOCUMENT_POSITION_FOLLOWING
        )
      );
    }),
  ).toBe(true);
  await panel
    .getByRole("button", { name: "更多活动（7）", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "更多活动", exact: true }),
  ).toBeVisible();
  await expect(panel.locator(".building-activity-card")).toHaveCount(7);
  await expect(panel.locator(".building-photo-preview")).toHaveCount(0);
  await panel.getByRole("button", { name: /隔离验收活动1/ }).click();
  await expect(page.locator(".public-article-dialog")).toBeVisible();
  await expect(page.locator(".public-article-body iframe")).toBeVisible();
  await page.getByRole("button", { name: "关闭文章详情", exact: true }).click();
  await panel.getByRole("button", { name: "返回", exact: true }).click();
  await expect(panel.locator(".building-activity-card")).toHaveCount(5);
  await panel
    .getByRole("button", { name: "更多图片（5）", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "更多图片", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "返回", exact: true }).click();
  await expect(panel.locator(".building-activity-card")).toHaveCount(5);
  mkdirSync("docs/verification/building-activities", { recursive: true });
  await page.screenshot({
    path: `docs/verification/building-activities/${info.project.name}-activities.png`,
  });
});

test("mobile building drawer grows from a touch drag, collapses, and keeps content scrolling separate", async ({
  page,
  isMobile,
}, info) => {
  test.skip(!isMobile, "Mobile snap points");
  await page.goto("/map");
  await page.getByRole("button", { name: "查看图书馆", exact: true }).click();
  const frame = page.locator(".place-details-frame"),
    handle = page.locator(".place-drag-handle");
  await expect(handle).toHaveAttribute("aria-valuenow", "62");
  const initial = (await frame.boundingBox())!;
  const grab = (await handle.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const x = grab.x + grab.width / 2,
    y = grab.y + grab.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let step = 1; step <= 14; step++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - step * 16 }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(handle).toHaveAttribute("aria-valuenow", "100");
  await expect
    .poll(async () => (await frame.boundingBox())!.height)
    .toBeGreaterThan(initial.height + 150);
  const full = (await frame.boundingBox())!;
  expect(full.y).toBeGreaterThanOrEqual(10);
  const nav = (await page.locator(".mobile-navigation").boundingBox())!;
  expect(full.y + full.height).toBeLessThanOrEqual(nav.y + 2);
  await page.locator(".place-details-content").evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await expect(handle).toHaveAttribute("aria-valuenow", "100");
  await expect(
    page.getByRole("button", { name: "关闭地点详情" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "收起建筑详情", exact: true }).click();
  await expect(handle).toHaveAttribute("aria-valuenow", "62");
  await expect
    .poll(async () => (await frame.boundingBox())!.height)
    .toBeLessThan(full.height - 100);
  await handle.focus();
  await page.keyboard.press("ArrowUp");
  await expect(handle).toHaveAttribute("aria-valuenow", "100");
  mkdirSync("docs/verification/building-activities", { recursive: true });
  await page.screenshot({
    path: `docs/verification/building-activities/${info.project.name}-expanded.png`,
  });
  await cdp.detach();
});

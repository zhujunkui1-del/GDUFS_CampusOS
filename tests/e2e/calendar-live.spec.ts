import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
test.skip(
  process.env.CALENDAR_LIVE !== "1",
  "Opt-in real Preview calendar acceptance",
);
test.use({ trace: "off" });
test("reported cards open the original reading view and retain the exact article title and source", async ({
  page,
}) => {
  await page.goto("/calendar?date=2026-10-20");
  const card = page
    .locator(".calendar-event")
    .filter({ hasText: "十五五" })
    .first();
  await expect(card.locator(".calendar-event-source")).toHaveText(
    "密茨凯维奇创新学院",
  );
  const title = await card.locator("strong").innerText();
  await card.locator(".calendar-event-open").click();
  await expect(page.locator(".public-article-dialog")).toBeVisible();
  await expect(page.locator("#public-article-title")).toHaveText(title);
  await expect(page.locator(".public-article-body iframe")).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator(".calendar-dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "关闭文章详情" }).click();
  await page.getByLabel("选择日期").fill("2026-11-06");
  await expect(page.locator(".calendar-event").first()).toBeVisible();
  for (const card of await page.locator(".calendar-event").all()) {
    expect(await card.locator("strong").innerText()).not.toMatch(
      /^分论坛一：|· 决赛$/,
    );
  }
});
test("a verified calendar venue opens the existing University Town map place", async ({
  page,
}) => {
  test.setTimeout(60000);
  const response = await page.request.get(
    "/api/public/activities?day=2026-10-29&after=2026-10-26&before=2026-11-01&limit=50",
  );
  const data = (await response.json()).data;
  const item = data.items.find(
    (i: { mapPlace: unknown; activity: { category: string } }) =>
      i.mapPlace && i.activity.category === "lecture",
  );
  expect(item).toBeDefined();
  await page.goto("/calendar?date=2026-10-29");
  await page
    .locator(`[data-event-id="${item.eventId}"] .calendar-map-link`)
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp("place=" + item.mapPlace.placeId));
  await expect(page.getByTestId("campus-map")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 40000 },
  );
  await expect(page.locator(".place-details-panel")).toBeVisible();
  await expect(page.locator(".place-details-panel")).toContainText(
    item.mapPlace.name,
  );
  await fs.writeFile(
    `.map-tools/calendar-20261030/map-live-${test.info().project.name}.json`,
    JSON.stringify({
      eventId: item.eventId,
      source: item.sources[0],
      place: item.mapPlace,
      url: page.url(),
    }),
  );
});
test("public week, actual date counts, direct reading, no filters and old-route compatibility", async ({
  page,
}, info) => {
  const receipts: unknown[] = [];
  page.on("response", async (response) => {
    if (new URL(response.url()).pathname != "/api/public/activities") return;
    try {
      const j = await response.json();
      receipts.push({
        url: response.url(),
        status: response.status(),
        data: j.data,
        error: j.error,
      });
    } catch {}
  });
  await page.goto("/schedule", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/calendar/);
  await expect(page.getByRole("heading", { name: /活动日历/ })).toBeVisible();
  await expect(page.getByText("登录服务尚未开放")).toHaveCount(0);
  await page.getByLabel("选择日期").fill("2026-11-07");
  await expect(page.locator(".calendar-week>button")).toHaveCount(7);
  await expect(
    page.locator(".calendar-week>button[aria-pressed=true]"),
  ).toHaveAttribute("aria-label", /2026-11-07/);
  await expect
    .poll(
      async () => {
        const r = await page.request.get(
          "/api/public/activities?after=2026-11-02&before=2026-11-08&day=2026-11-07",
        );
        const j = await r.json();
        return j.ok && j.data.items.length > 0;
      },
      { timeout: 30000 },
    )
    .toBe(true);
  await expect(page.locator(".calendar-event").first()).toBeVisible({
    timeout: 25000,
  });
  const r = await page.request.get(
    "/api/public/activities?after=2026-11-02&before=2026-11-08&day=2026-11-07",
  );
  const j = await r.json();
  expect(j.ok).toBe(true);
  expect(j.data.metrics.rowsWritten).toBe(0);
  expect(j.data.modelCalls).toBe(0);
  expect(j.data.dailyCounts["2026-11-07"]).toBe(j.data.total);
  await expect(page.locator(".calendar-event")).toHaveCount(
    j.data.items.reduce(
      (n: number, i: { sources: unknown[] }) => n + i.sources.length,
      0,
    ),
  );
  for (const item of j.data.items)
    for (const source of item.sources) {
      const card = page.locator(
        `[data-event-id="${item.eventId}"][data-article-id="${source.documentId}"]`,
      );
      await expect(card.locator("strong")).toHaveText(source.title);
      await expect(card.locator(".calendar-event-source")).toHaveText(
        source.source.name,
      );
    }
  expect(await page.locator(".calendar-agenda").innerText()).not.toMatch(
    /00:00|全天|地点未知|暂无地点/,
  );
  const dateOnly = j.data.items.find(
    (i: { activity: { startsAt: { at: string | null } } }) =>
      !i.activity.startsAt.at,
  );
  if (dateOnly) {
    const card = page.locator(`[data-event-id="${dateOnly.eventId}"]`).first();
    await expect(card).toContainText("11月7日");
    expect(await card.innerText()).not.toMatch(/00:00|全天/);
  }
  await page.locator(".calendar-event-open").first().click();
  const dialog = page.getByRole("dialog", {
    name: j.data.items[0].sources[0].title,
  });
  await expect(dialog).toBeVisible();
  const first = j.data.items[0];
  await expect(dialog.locator(".public-article-original")).toHaveAttribute(
    "href",
    first.sources[0].originalUrl,
  );
  await expect(page.locator(".calendar-dialog")).toHaveCount(0);
  await dialog.getByRole("button", { name: "关闭文章详情" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "刷新活动" })).toBeVisible();
  await page.getByRole("button", { name: "下一周", exact: true }).click();
  await expect(page.getByLabel("选择日期")).toHaveValue("2026-11-14");
  await page.getByRole("button", { name: "上一周", exact: true }).click();
  await expect(page.getByLabel("选择日期")).toHaveValue("2026-11-07");
  await page.getByRole("button", { name: "今天", exact: true }).click();
  await expect(page.getByLabel("选择日期")).toHaveValue(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(
      new Date(j.data.now),
    ),
  );
  await page.getByLabel("选择日期").fill("2026-11-07");
  await expect(page.locator(".calendar-event").first()).toBeVisible();
  const multi = j.data.items.find(
    (i: {
      activity: { startsAt: { date: string }; endsAt: { date: string } | null };
    }) =>
      i.activity.endsAt && i.activity.endsAt.date > i.activity.startsAt.date,
  );
  if (multi) {
    for (const day of ["2026-11-06", "2026-11-07", "2026-11-08"]) {
      const r = await page.request.get(
        "/api/public/activities?after=2026-11-02&before=2026-11-08&day=" +
          day +
          "&limit=50",
      );
      const result = await r.json();
      expect(
        result.data.items.filter(
          (i: { eventId: string }) => i.eventId === multi.eventId,
        ),
      ).toHaveLength(1);
    }
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);
  await fs.mkdir("docs/verification/calendar-2026-10-30", { recursive: true });
  await page.screenshot({
    path: `docs/verification/calendar-2026-10-30/${info.project.name}.png`,
    fullPage: false,
  });
  await fs.mkdir(".map-tools/calendar-20261030", { recursive: true });
  await fs.writeFile(
    `.map-tools/calendar-20261030/browser-${info.project.name}.json`,
    JSON.stringify(
      {
        project: info.project.name,
        date: "2026-11-07",
        weekCounts: j.data.dailyCounts,
        events: j.data.items.map(
          (i: { eventId: string; activity: unknown; sources: unknown }) => ({
            eventId: i.eventId,
            activity: i.activity,
            sources: i.sources,
          }),
        ),
        receipts,
      },
      null,
      2,
    ),
  );
});

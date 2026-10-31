import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

test.skip(
  process.env.CAMPUS_UI_LIVE !== "1",
  "Opt-in Preview layout, paging and launcher verification",
);
test.use({ trace: "off" });
test.setTimeout(90000);
const dir = ".map-tools/campus-ui-20261031";

test("calendar fills the feed width and the portrait orb opens the assistant with a blue hover glow", async ({
  page,
}, info) => {
  await page.goto("/calendar");
  await expect(page.locator(".calendar-week")).toBeVisible();
  const calendar = await page.locator(".public-calendar").boundingBox();
  const launcher = page.getByRole("button", {
    name: "打开校园助理",
    exact: true,
  });
  await expect(launcher.locator("img")).toBeVisible();
  await expect
    .poll(() =>
      launcher
        .locator("img")
        .evaluate(
          (image) =>
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth > 0,
        ),
    )
    .toBe(true);
  const size = await launcher.boundingBox();
  expect(Math.abs(size!.width - size!.height)).toBeLessThan(1);
  await expect(launcher).toHaveCSS("border-radius", "50%");
  let hoverShadow: string | undefined;
  if (info.project.name === "desktop") {
    await launcher.hover();
    await expect
      .poll(() => launcher.evaluate((e) => getComputedStyle(e).boxShadow))
      .toContain("47, 137, 255");
    hoverShadow = await launcher.evaluate((e) => getComputedStyle(e).boxShadow);
  }
  await launcher.click();
  await expect(page.locator("#campus-assistant")).toBeVisible();
  await page.getByRole("button", { name: "收起校园助理", exact: true }).click();
  await expect(page.locator("#campus-assistant")).not.toBeVisible();
  await page.goto("/radar");
  const feed = await page.locator(".public-feed").boundingBox();
  expect(
    Math.abs(calendar!.x + calendar!.width - (feed!.x + feed!.width)),
  ).toBeLessThan(2);
  expect(Math.abs(calendar!.width - feed!.width)).toBeLessThan(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
  ).toBe(false);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    `${dir}/layout-${info.project.name}.json`,
    JSON.stringify({ calendar, feed, launcher: size, hoverShadow }, null, 2),
  );
  await page.goto("/calendar");
  await expect(page.locator(".calendar-event").first()).toBeVisible();
  await page.screenshot({ path: `${dir}/calendar-${info.project.name}.png` });
});

test("real radar pages jump once to a deep page, then continue with cursor navigation", async ({
  page,
}, info) => {
  await page.goto("/radar");
  await page.getByRole("button", { name: /^校园资讯\s*\d+/ }).click();
  const input = page.getByLabel("当前页码", { exact: true });
  await expect(input).toHaveValue("1");
  const pages = Number(
    (await page.locator(".public-feed-page-jump span").innerText()).replace(
      /\D/g,
      "",
    ),
  );
  expect(pages).toBeGreaterThan(20);
  const calls: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/public/content") calls.push(u.search);
  });
  await input.fill("20");
  await input.press("Enter");
  await expect(input).toHaveValue("20");
  await expect(page.locator(".public-feed-card").first()).toBeVisible();
  const at20 = await page
    .locator(".public-feed-card")
    .first()
    .getAttribute("aria-label");
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain("page=20");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(input).toHaveValue("21");
  expect(calls.at(-1)).toContain("cursor=");
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(input).toHaveValue("20");
  await expect(page.locator(".public-feed-card").first()).toHaveAttribute(
    "aria-label",
    at20!,
  );
  if (info.project.name === "desktop") {
    await input.fill("99999");
    await input.press("Enter");
    await expect(input).toHaveValue(String(pages));
    await expect(
      page.getByRole("button", { name: "下一页", exact: true }),
    ).toBeDisabled();
  }
  await input.fill("0");
  await input.press("Enter");
  await expect(input).toHaveValue("1");
  await expect(
    page.getByRole("button", { name: "上一页", exact: true }),
  ).toBeDisabled();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    `${dir}/paging-${info.project.name}.json`,
    JSON.stringify({ pages, deepPageTitle: at20, requests: calls }, null, 2),
  );
});

test("knowledge categories use the same editable page box with complete page and empty-result behaviour", async ({
  page,
}) => {
  const category = "campus_life";
  const all = Array.from({ length: 26 }, (_, i) => ({
    id: `isolated-guide-${i}`,
    version: 1,
    title: `隔离指南${i + 1}`,
    url: "https://example.invalid/guide",
    publishedAt: "2026-10-01",
    readable: false,
    knowledgeCategory: category,
    radarCategory: null,
    contentType: "guide",
    source: { name: "隔离测试来源", official: false },
  }));
  await page.route("**/api/public/content?*", async (route) => {
    const u = new URL(route.request().url()),
      size = 12;
    const items = u.searchParams.get("q") ? [] : all;
    const start = u.searchParams.has("cursor")
      ? Number(u.searchParams.get("cursor"))
      : (Number(u.searchParams.get("page") || 1) - 1) * size;
    await route.fulfill({
      json: {
        ok: true,
        data: {
          items: items.slice(start, start + size),
          groups: { [category]: items.slice(0, size) },
          counts: { [category]: items.length },
          total: items.length,
          offset: start,
          hasMore: start + size < items.length,
          nextCursor: start + size < items.length ? String(start + size) : null,
        },
      },
    });
  });
  await page.goto("/knowledge");
  await page.getByRole("button", { name: /^校园生活\s*26/ }).click();
  const input = page.getByLabel("当前页码", { exact: true });
  await expect(input).toHaveValue("1");
  await expect(page.locator(".public-feed-page-jump")).toContainText("/ 3");
  await input.fill("3");
  await input.press("Enter");
  await expect(input).toHaveValue("3");
  await expect(page.locator(".public-feed-card")).toHaveCount(2);
  await expect(page.locator(".public-feed-card").first()).toContainText(
    "隔离指南25",
  );
  await input.fill("2");
  await input.press("Escape");
  await expect(input).toHaveValue("3");
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(input).toHaveValue("2");
  await expect(page.locator(".public-feed-card").first()).toContainText(
    "隔离指南13",
  );
  await page.getByLabel("搜索标题", { exact: true }).fill("no-result");
  await expect(input).toHaveValue("0");
  await expect(input).toBeDisabled();
  await expect(page.locator(".public-feed-page-jump")).toContainText("/ 0");
});

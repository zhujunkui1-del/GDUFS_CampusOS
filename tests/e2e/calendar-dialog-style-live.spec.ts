import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

test.skip(
  process.env.CALENDAR_LIVE !== "1",
  "Explicit Preview article style regression",
);
test.use({ trace: "off" });
test.setTimeout(60000);
test("calendar article styles work on a cold deep link, reload, and navigation from feed pages", async ({
  page,
}, info) => {
  const url =
    "/calendar?date=2026-10-31&event=event-c013ed082957ae0a373e2fac3fe0ad774695d2c0&article=wx-d72d61ad1bc02ddbf1dc64529a0ee71effc5c8a5";
  const samples: unknown[] = [];
  const inspect = async (stage: string) => {
    const dialog = page.locator(".public-article-dialog");
    await expect(dialog).toBeVisible();
    const value = await page
      .locator(".public-article-dialog-panel")
      .evaluate((panel) => {
        const toolbar = panel.querySelector(".public-article-dialog-toolbar")!;
        const content = panel.querySelector(".public-article-dialog-content")!;
        const style = getComputedStyle(panel);
        return {
          display: style.display,
          radius: style.borderRadius,
          toolbarDisplay: getComputedStyle(toolbar).display,
          overflow: getComputedStyle(content).overflowY,
          width: panel.getBoundingClientRect().width,
          viewport: innerWidth,
        };
      });
    samples.push({ stage, ...value });
    return value;
  };
  await fs.mkdir(".map-tools/calendar-dialog-20261031", { recursive: true });
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    const cold = await inspect("cold");
    await page.screenshot({
      path: `.map-tools/calendar-dialog-20261031/${info.project.name}-cold.png`,
    });
    expect(cold.display).toBe("flex");
    expect(parseFloat(cold.radius)).toBeGreaterThanOrEqual(19);
    expect(cold.toolbarDisplay).toBe("flex");
    expect(cold.overflow).toBe("auto");
    await page.reload({ waitUntil: "networkidle" });
    expect(await inspect("reload")).toEqual(cold);
    await page.getByRole("button", { name: "关闭文章详情" }).click();
    const nav = page.getByRole("navigation", {
      name: info.project.name === "mobile" ? "手机主导航" : "桌面主导航",
    });
    for (const [path, label] of [
      ["/radar", info.project.name === "mobile" ? "雷达" : "校园雷达"],
      ["/knowledge", info.project.name === "mobile" ? "知识" : "校园知识"],
    ]) {
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(path + "$"));
      await nav
        .getByRole("link", {
          name: info.project.name === "mobile" ? "日历" : "活动日历",
          exact: true,
        })
        .click();
      await page.getByLabel("选择日期").fill("2026-10-31");
      await page
        .locator(".calendar-event")
        .filter({ hasText: "金羊奖" })
        .locator(".calendar-event-open")
        .click();
      expect(await inspect(path)).toEqual(cold);
      await page.getByRole("button", { name: "关闭文章详情" }).click();
    }
  } finally {
    await fs.writeFile(
      `.map-tools/calendar-dialog-20261031/${info.project.name}.json`,
      JSON.stringify(samples, null, 2),
    );
  }
});

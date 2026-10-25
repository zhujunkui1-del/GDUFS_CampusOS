import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const dir = "docs/verification/article-analysis-2026-10-25";
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const records = [];
try {
  for (const [mode, viewport] of [
    ["desktop", { width: 1368, height: 950 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [],
      responses = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.url().includes("/api/public/"))
        responses.push({ status: r.status(), path: new URL(r.url()).pathname });
    });
    await page.goto("https://campusos-preview.zhujunkui1.workers.dev/radar", {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator(".public-feed-group")
      .first()
      .waitFor({ timeout: 30000 });
    await page
      .getByRole("searchbox", { name: "搜索标题" })
      .fill("金融热点分析大赛");
    const card = page
      .locator(".public-feed-card")
      .filter({ hasText: "金融学院第六届金融热点分析大赛参赛指南" })
      .first();
    await card.waitFor({ timeout: 30000 });
    assert.equal(
      await card.locator(".article-registration-badge").innerText(),
      "报",
    );
    const colors = await card
      .locator(".article-registration-badge")
      .evaluate((el) => ({
        color: getComputedStyle(el).color,
        background: getComputedStyle(el).backgroundColor,
        radius: getComputedStyle(el).borderRadius,
        weight: getComputedStyle(el).fontWeight,
      }));
    await page.screenshot({
      path: dir + `/radar-registration-${mode}.png`,
      fullPage: true,
    });
    await card.click();
    await page.locator("dialog[open] #public-article-title").waitFor();
    assert.equal(
      await page
        .locator("dialog[open] .article-registration-badge")
        .innerText(),
      "报",
    );
    await page.locator("dialog iframe").waitFor({ timeout: 20000 });
    await page.screenshot({
      path: dir + `/article-registration-${mode}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "关闭文章详情" }).click();
    await page.goto(
      "https://campusos-preview.zhujunkui1.workers.dev/knowledge",
      { waitUntil: "domcontentloaded" },
    );
    await page
      .locator(".public-feed-group")
      .first()
      .waitFor({ timeout: 30000 });
    await page
      .getByRole("searchbox", { name: "搜索标题" })
      .fill("电子就业协议");
    await page
      .locator(".public-feed-card")
      .filter({ hasText: "电子就业协议" })
      .first()
      .waitFor({ timeout: 30000 });
    await page.screenshot({
      path: dir + `/knowledge-${mode}.png`,
      fullPage: true,
    });
    assert.equal(errors.length, 0);
    assert.ok(responses.every((r) => r.status === 200));
    records.push({
      mode,
      errors,
      responses,
      colors,
      badgePresentAfterDeadline: true,
    });
    await page.close();
  }
} finally {
  await browser.close();
  writeFileSync(
    dir + "/browser.json",
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        browser: "Edge",
        realPreview: true,
        records,
      },
      null,
      2,
    ) + "\n",
  );
}
console.log(JSON.stringify(records));

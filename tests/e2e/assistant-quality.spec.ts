import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
test.setTimeout(60000);

test("smart search is persisted per conversation and Markdown is readable", async ({
  page,
}, info) => {
  const id = randomUUID();
  let enabled = false;
  const history = () => ({
    conversationId: id,
    smartSearch: enabled,
    title: "排版与搜索设置",
    selectedPlaceId: null,
    activeRouteId: null,
    messages: [
      { id: randomUUID(), role: "user", text: "请整理资料", cards: [] },
      {
        id: randomUUID(),
        role: "assistant",
        text: "## 核心信息\n\n**清楚的结论** [1]\n\n1. 第一项\n2. 第二项\n\n> 原文证据\n\n| 项目 | 信息 |\n| --- | --- |\n| 日期 | 按原文 |",
        cards: [
          {
            kind: "source",
            documentId: "ui-fixture",
            title: "隔离UI测试原文",
            sourceName: "测试",
            originalUrl: "https://example.org/source",
            publishedAt: "2026-11-03",
            snippet: "隔离测试",
            evidenceType: "full_text",
            classificationState: "unknown",
            validity: "unknown",
            readable: true,
          },
        ],
      },
    ],
  });
  await page.route("**/api/agent/session", (r) =>
    r.fulfill({
      json: {
        ok: true,
        data: {
          scopeKey: "ui-quality",
          kind: "guest",
          model: { ready: true },
          history: history(),
        },
      },
    }),
  );
  await page.route(`**/api/agent/conversations/${id}*`, (r) => {
    if (r.request().method() === "PATCH")
      enabled = r.request().postDataJSON().smartSearch;
    return r.fulfill({
      json: {
        ok: true,
        data:
          r.request().method() === "PATCH"
            ? { smartSearch: enabled }
            : history(),
      },
    });
  });
  await page.goto("/radar", { waitUntil: "domcontentloaded" });
  async function openPanel() {
    await expect(async () => {
      if (
        !(await page
          .getByRole("button", { name: "智能搜索", exact: true })
          .isVisible())
      )
        await page.getByRole("button", { name: "打开校园助理" }).click();
      await expect(
        page.getByRole("button", { name: "智能搜索", exact: true }),
      ).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });
  }
  await openPanel();
  const toggle = page.getByRole("button", { name: "智能搜索", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect.poll(() => enabled).toBe(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await openPanel();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".assistant-markdown h2")).toHaveText("核心信息");
  await expect(page.locator(".assistant-markdown ol li")).toHaveCount(2);
  await expect(page.locator(".assistant-citation a")).toHaveAttribute(
    "href",
    "https://example.org/source",
  );
  await expect(page.locator(".assistant-sources")).not.toHaveAttribute(
    "open",
    "",
  );
  expect(
    await page
      .locator(".assistant-frame")
      .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
  ).toBe(true);
  await mkdir("docs/verification/assistant-quality-2026-11-03", {
    recursive: true,
  });
  await page.screenshot({
    path: `docs/verification/assistant-quality-2026-11-03/markdown-${info.project.name}.png`,
  });
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

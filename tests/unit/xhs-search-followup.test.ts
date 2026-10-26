import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import { externalPolicy } from "@/lib/server/external-search/policy";
import { AssistantSources } from "@/features/assistant/components/assistant-sources";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
it("keeps the actual canteen topic when the user asks to use Xiaohongshu", () => {
  const intent = contentIntent("调用小红书来查", [
    { id: "1", role: "user", text: "广外南校一饭有什么好吃的", cards: [] },
  ]);
  expect(intent.query).toContain("南校一饭");
  expect(externalPolicy(intent.query)).toMatchObject({
    intent: "experience",
    useXiaohongshu: true,
    explicit: true,
  });
});
it("skips earlier search-only followups when finding the topic", () => {
  const intent = contentIntent("再用小红书查一下", [
    { id: "1", role: "user", text: "广外南校一饭有什么好吃的", cards: [] },
    { id: "2", role: "user", text: "调用小红书来查", cards: [] },
  ]);
  expect(intent.query).toContain("南校一饭");
});
it("respects explicit platform requests without turning policy deadlines into social facts", () => {
  expect(externalPolicy("小红书搜广外校庆感受").useXiaohongshu).toBe(true);
  expect(externalPolicy("小红书查奖学金截止日期").useXiaohongshu).toBe(false);
});
it("removes uncited candidates from the visible sources while keeping original numbers", () => {
  const one: AssistantCard = {
    kind: "external_source",
    title: "未使用的候选",
    originalUrl: "https://example.test/unused",
    sourceName: "其他",
    publishedAt: null,
    snippet: "unused",
    authority: "unverified",
    evidenceKind: "search_excerpt",
    searchMode: "web",
  };
  const two: AssistantCard = {
    ...one,
    title: "实际引用",
    originalUrl: "https://example.test/used",
  };
  const html = renderToStaticMarkup(
    createElement(AssistantSources, {
      cards: [one, two],
      text: "真实内容[来源2]",
    }),
  );
  expect(html).toContain("1 个来源");
  expect(html).toContain("来源2");
  expect(html).not.toContain("未使用的候选");
});

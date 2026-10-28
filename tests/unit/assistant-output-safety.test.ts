import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantSources } from "@/features/assistant/components/assistant-sources";
import { AssistantMessageText } from "@/features/assistant/components/assistant-message-text";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import { foodEvidenceAnswer } from "@/lib/server/assistant/evidence-answer";
const card: AssistantCard = {
  kind: "source",
  documentId: "fixture",
  title: "新书速递｜馆藏上新",
  sourceName: "隔离图书来源",
  originalUrl: "https://example.invalid/book",
  publishedAt: "2026-10-19",
  snippet: "《这本书很好吃》，关于美食味道的阅读。",
  evidenceType: "full_text",
  classificationState: "unknown",
  validity: "unknown",
  readable: true,
};
it("hides unrelated historical source cards and references for a food question", () => {
  const props = {
    question: "有什么好吃的吗",
    cards: [card],
    text: "暂未取得食堂推荐[来源1]",
  };
  expect(renderToStaticMarkup(createElement(AssistantSources, props))).toBe("");
  expect(
    renderToStaticMarkup(createElement(AssistantMessageText, props)),
  ).not.toContain("example.invalid/book");
});
it("does not show raw pseudo tool calls or their stale source list from stored history", () => {
  const props = {
    question: "有什么好吃的",
    cards: [card],
    text: "<tool_call><function=search_external_campus_info><parameter=query>广外</parameter></function></tool_call>",
  };
  const text = renderToStaticMarkup(createElement(AssistantMessageText, props));
  expect(text).not.toContain("tool_call");
  expect(text).not.toContain("search_external_campus_info");
  expect(text).toContain("请重新提问");
  expect(renderToStaticMarkup(createElement(AssistantSources, props))).toBe("");
});
it("recovers only real food excerpts, retains source numbering and never turns metadata into a body", () => {
  const food: AssistantCard = {
    kind: "external_source",
    title: "南校一饭餐品分享",
    sourceName: "隔离作者",
    originalUrl: "https://example.invalid/food",
    snippet: "我喜欢一饭的自选咕噜肉。",
    publishedAt: "2026-09-17",
    authority: "student_experience",
    evidenceKind: "page_excerpt",
    searchMode: "platform",
  };
  const result = foodEvidenceAnswer(
    [card, food],
    "广外南校一饭有什么好吃的",
    true,
  );
  expect(result).toContain("我喜欢一饭的自选咕噜肉");
  expect(result).toContain("[来源2]");
  expect(result).not.toContain("新书");
  expect(result).not.toContain("亲自吃过");
  expect(
    foodEvidenceAnswer(
      [{ ...food, evidenceKind: "title_only" }],
      "广外一饭推荐",
      false,
    ),
  ).toBeUndefined();
});

import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { AssistantSources } from "@/features/assistant/components/assistant-sources";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
const cards: AssistantCard[] = [
  {
    kind: "source",
    documentId: "doc",
    title: "借阅指南",
    originalUrl: "https://lib.gdufs.edu.cn/guide",
    sourceName: "广外图书馆",
    publishedAt: "2026-09-05",
    snippet: "不能显示的正文摘录",
    evidenceType: "full_text",
    classificationState: "unknown",
    validity: "unknown",
    readable: true,
  },
  {
    kind: "external_source",
    title: "食堂体验",
    originalUrl: "https://www.xiaohongshu.com/explore/test",
    sourceName: "小红书",
    publishedAt: null,
    snippet: "另一个不能显示的摘录",
    authority: "student_experience",
    evidenceKind: "page_excerpt",
    searchMode: "platform",
  },
];
it("uses one collapsed disclosure for all real sources", () => {
  const html = renderToStaticMarkup(createElement(AssistantSources, { cards }));
  const { document } = parseHTML(html);
  const details = document.querySelectorAll("details");
  expect(details).toHaveLength(1);
  expect(details[0].hasAttribute("open")).toBe(false);
  expect(details[0].querySelector("summary")?.textContent).toBe("2 个来源");
  expect(document.querySelectorAll("article")).toHaveLength(2);
  expect(document.querySelectorAll("a")).toHaveLength(2);
  expect(html).toContain("来源1 · 广外图书馆 · 2026/09/05");
  expect(html).toContain("来源2 · 小红书 · 发布日期未知");
  for (const text of [
    "不能显示",
    "查看证据",
    "正文证据",
    "校园资讯",
    "有效性待确认",
    "学生经验",
    "原文摘录",
  ])
    expect(html).not.toContain(text);
  expect(document.querySelectorAll("p,small")).toHaveLength(0);
});
it("does not add an empty source button", () =>
  expect(
    renderToStaticMarkup(createElement(AssistantSources, { cards: [] })),
  ).toBe(""));

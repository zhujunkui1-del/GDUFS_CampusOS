import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AssistantMessageText } from "@/features/assistant/components/assistant-message-text";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
const cards: AssistantCard[] = [
  {
    kind: "source",
    documentId: "sample",
    title: "真实原文",
    sourceName: "公开来源",
    originalUrl: "https://example.org/article",
    publishedAt: null,
    snippet: "真实证据",
    evidenceType: "full_text",
    classificationState: "unknown",
    validity: "unknown",
    readable: true,
  },
];
it("links only the task title and removes the obsolete footer from past messages", () => {
  const html = renderToStaticMarkup(
    createElement(AssistantMessageText, {
      cards: [],
      text: "- 参加：[校园宣讲](<https://example.org/article>)  \n  ⏱️逾期时间:11/19 13:50  \n  📝备注：带学生证，参考 https://example.org/notes\n\n[打开我的收藏与待办](/account/favorites)",
    }),
  );
  expect(html.match(/<a /g)).toHaveLength(1);
  expect(html).toMatch(/参加：<a [^>]+>校园宣讲<\/a><br\/>/);
  expect(html).toMatch(/⏱️逾期时间:11\/19 13:50<br\/>\s*📝备注：带学生证/);
  expect(html).not.toContain("打开我的收藏与待办");
});
it("renders semantic blocks and exact evidence citations", () => {
  const html = renderToStaticMarkup(
    createElement(AssistantMessageText, {
      cards,
      text: "## 标题\n\n**重点** [1]\n\n1. 第一项\n2. 第二项\n\n> 原文\n\n| 项目 | 说明 |\n| --- | --- |\n| A | B |\n\n```ts\nconst n = [1];\n```",
    }),
  );
  expect(html).toContain("<h2>标题</h2>");
  expect(html).toContain("<strong>重点</strong>");
  expect(html).toContain("<ol>");
  expect(html).toContain("<blockquote>");
  expect(html).toContain("<table>");
  expect(html.match(/class="assistant-citation"/g)).toHaveLength(1);
  expect(html).toContain('href="https://example.org/article"');
  expect(html).toContain("const n = [1];");
});
it("does not execute raw HTML, unsafe links or remote image beacons", () => {
  const html = renderToStaticMarkup(
    createElement(AssistantMessageText, {
      cards: [],
      text: "<script>alert(1)</script>\n\n[x](javascript:alert)\n\n![x](https://example.org/beacon)\n\n[99]",
    }),
  );
  expect(html).not.toMatch(/<script|javascript:|<img|assistant-citation/);
});

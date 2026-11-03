import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { AssistantMessageText } from "@/features/assistant/components/assistant-message-text";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
const source: AssistantCard = {
  kind: "external_source",
  title: "实际来源标题",
  originalUrl: "https://example.test/article",
  sourceName: "来源名称",
  publishedAt: "2026-10-26",
  snippet: "机器证据不展示",
  authority: "unverified",
  evidenceKind: "page_excerpt",
  searchMode: "web",
};
it("replaces a valid numbered citation with a small linked source label", () => {
  const html = renderToStaticMarkup(
    createElement(AssistantMessageText, {
      text: "这是一句话[来源1]。",
      cards: [source],
    }),
  );
  const { document } = parseHTML(html);
  const sup = document.querySelector("sup");
  expect(sup?.className).toBe("assistant-citation");
  expect(sup?.textContent).toBe("[1]");
  expect(sup?.querySelector("a")?.getAttribute("href")).toBe(
    source.originalUrl,
  );
  expect(html).not.toContain("[来源1]");
});
it("keeps an invalid reference as text and escapes untrusted page text", () => {
  const html = renderToStaticMarkup(
    createElement(AssistantMessageText, {
      text: "<script>bad</script>[来源9]",
      cards: [source],
    }),
  );
  expect(html).not.toContain("assistant-citation");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<a");
});

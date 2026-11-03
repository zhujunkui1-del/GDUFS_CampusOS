import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { AssistantMessageText } from "@/features/assistant/components/assistant-message-text";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";

const sourceUrl = "https://youth.gdufs.edu.cn/info/1050/12132.htm";
const cards: AssistantCard[] = [
  {
    kind: "source",
    documentId: "doc-1",
    title: "关于招募志愿者的通知",
    originalUrl: sourceUrl,
    sourceName: "团学时空",
    publishedAt: "2026-10-20",
    snippet: "报名截止时间另行通知。",
    evidenceType: "full_text",
    classificationState: "unknown",
    validity: "unknown",
    readable: true,
  },
];

it("renders [n] as a clickable superscript citation", () => {
  const html = renderToStaticMarkup(
    createElement(AssistantMessageText, {
      text: "报名截止时间另行通知[1]。",
      cards,
    }),
  );
  const { document } = parseHTML(html);
  const link = document.querySelector("sup.assistant-citation a");
  expect(link?.textContent).toBe("[1]");
  expect(link?.getAttribute("href")).toBe(sourceUrl);
  expect(document.querySelector("sup.assistant-citation")?.textContent).toBe(
    "[1]",
  );
});

it("keeps legacy [来源n] citations working", () => {
  const html = renderToStaticMarkup(
    createElement(AssistantMessageText, {
      text: "旧格式[来源1]。",
      cards,
    }),
  );
  const { document } = parseHTML(html);
  expect(document.querySelectorAll("sup.assistant-citation")).toHaveLength(1);
  expect(document.querySelector("sup.assistant-citation a")?.textContent).toBe(
    "[1]",
  );
});

it("leaves citations without a matching card as text", () => {
  const html = renderToStaticMarkup(
    createElement(AssistantMessageText, { text: "没有来源[9]。", cards }),
  );
  const { document } = parseHTML(html);
  expect(document.querySelector("sup")).toBeNull();
  expect(html).not.toContain("[9]");
});

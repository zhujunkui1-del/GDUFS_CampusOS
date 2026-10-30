import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantSources } from "@/features/assistant/components/assistant-sources";
import { AssistantMessageText } from "@/features/assistant/components/assistant-message-text";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import { foodEvidenceAnswer } from "@/lib/server/assistant/evidence-answer";
import { stripSelfDeprecation } from "@/lib/assistant-output";
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
  expect(result).toContain("[2]");
  expect(result).not.toContain("新书");
  expect(result).not.toContain("亲自吃过");
  expect(
    foodEvidenceAnswer(
      [{ ...food, evidenceKind: "title_only" }],
      "广外一饭推荐",
      false,
    ),
  ).toBeUndefined();
  expect(
    foodEvidenceAnswer([food], "花生过敏在南校一饭吃什么", false),
  ).toBeUndefined();
});

it("does not expose self-deprecating retrieval process talk", () => {
  expect(
    stripSelfDeprecation(
      "考研报名条件、保研推免办法等完整政策，本轮未取得官方原文，建议以研究生院官网最新通知为准。",
    ),
  ).toBe(
      "考研报名条件、保研推免办法等完整政策，建议以研究生院和研究生招生官网最新通知为准。",
    );
  expect(
    stripSelfDeprecation("保研的专门实施办法本轮未取得完整原文。"),
  ).toBe("保研的专门实施办法，建议以研究生院和研究生招生官网最新通知为准。");
  expect(stripSelfDeprecation("本次没有检索到资料。")).toBe(
    "建议以官方最新通知为准。",
  );
  expect(
    stripSelfDeprecation(
      "4. 完整推免办法本轮未取得完整原文，建议以研究生院官网为准。",
    ),
  ).toBe("4. 完整推免办法，建议以研究生院和研究生招生官网最新通知为准。");
  expect(stripSelfDeprecation("这是本轮资料中唯一直接涉及推免的规则。")).toBe(
    "这是公开资料中唯一直接涉及推免的规则。",
  );
  expect(
    stripSelfDeprecation(
      "推免流程，本轮资料未涉及，建议以研究生院官网为准。",
    ),
  ).toBe("推免流程，建议以研究生院和研究生招生官网最新通知为准。");
  expect(
    stripSelfDeprecation(
      "不过现有资料未覆盖完整的推免遴选办法，建议以官网为准。",
    ),
  ).toBe("建议以研究生院和研究生招生官网最新通知为准。");
  expect(
    stripSelfDeprecation(
      "现有资料能确认部分安排，但未检索到一份完整的政策文件，建议以官网为准。",
    ),
  ).toBe("现有资料能确认部分安排，建议以官方最新通知为准。");
  expect(
    stripSelfDeprecation(
      "需要说明：本轮来源未显示发布方为“广外青年”，也未明确写出“我校”即广外，这两点暂无法确认。",
    ),
  ).toBe("");
  expect(
    stripSelfDeprecation(
      "发布方在正文中没有明确写出，本鱼就不替它认领啦。该信息时效性待核实，报名细节建议以校团委最新通知为准 [1]。",
    ),
  ).toBe("报名细节建议以校团委最新通知为准 [1]。");

  expect(
    stripSelfDeprecation(
      "王春业老师是广外纪检监察研究院院长、教授 [1]。以上信息时效性待核实，具体以学校官方最新信息为准。🐟",
    ),
  ).toBe("王春业老师是广外纪检监察研究院院长、教授 [1]。🐟");
});

import { expect, it } from "vitest";
import { inputGate } from "@/lib/server/assistant/input-gate";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import { buildQueryPlan, queryRelevance } from "@/lib/retrieval/query-plan";
import { restoredSearchPreference } from "@/features/assistant/conversation-state";

it.each(["你好，你是一只大肥鱼吗？", "今天好累，陪我聊聊天", "你是谁？"])(
  "lets daily conversation reach the persona model: %s",
  (message) => {
    expect(inputGate(message)).toBe("conversation");
    expect(contentIntent(message).active).toBe(false);
  },
);

it("does not inherit an old topic for an explicit new entity", () => {
  const previous = [
    {
      id: "1",
      role: "user" as const,
      text: "最近有什么竞赛？",
      cards: [],
      createdAt: 1,
    },
  ];
  const result = contentIntent("还有王春业老师的介绍吗？", previous);
  expect(result.query).not.toContain("最近有什么竞赛");
});
it("article intent overrides persona words inside a title", () => {
  const message = "找文章《海底小鱼干不存在文档987654321》";
  expect(inputGate(message)).toBe("campus");
  expect(contentIntent(message).active).toBe(true);
  expect(contentIntent(message).articleLookup).toBe(true);
});
it("separates source selection and recency from content keywords", () => {
  const result = contentIntent("请上网查广外官网最新资料");
  expect(result.recentDiscovery).toBe(true);
  expect(result.retrievalQuery).toBe("校园资讯");
});
it("does not turn a search-mode prefix into article-title constraints", () => {
  const query = contentIntent(
    "关闭智能搜索后再次查询校园文章：最近有什么竞赛？",
  );
  expect(query.query).toBe("最近有什么竞赛？");
  expect(query.articleLookup).toBe(false);
  expect(query.recentDiscovery).toBe(true);
});
it("ignores an older history preference arriving after a confirmed toggle", () => {
  const prior = {
    id: "one",
    messages: [],
    title: "test",
    smartSearch: true,
    smartSearchVersion: 2,
  };
  expect(
    restoredSearchPreference(
      prior,
      { conversationId: "one", smartSearch: false, smartSearchVersion: 1 },
      false,
    ).smartSearch,
  ).toBe(true);
  expect(
    restoredSearchPreference(
      prior,
      { conversationId: "one", smartSearch: false, smartSearchVersion: 3 },
      false,
    ).smartSearch,
  ).toBe(false);
  expect(
    restoredSearchPreference(
      prior,
      { conversationId: "two", smartSearch: false, smartSearchVersion: 0 },
      false,
    ).smartSearch,
  ).toBe(false);
});
it("keeps unknown subjects and explicit years when the concept dictionary has no entry", () => {
  const plan = buildQueryPlan("2025年全运会");
  expect(queryRelevance(plan, { title: "2026年模拟联合国获奖" }).relevant).toBe(
    false,
  );
  expect(queryRelevance(plan, { title: "2026年全运会志愿服务" }).relevant).toBe(
    false,
  );
  expect(queryRelevance(plan, { title: "2025年全运会志愿服务" }).relevant).toBe(
    true,
  );
});

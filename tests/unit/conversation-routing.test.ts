import { expect, it } from "vitest";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import { conversationAct } from "@/lib/server/assistant/conversation-act";
import {
  contentInstructions,
  directInstructions,
} from "@/lib/server/assistant/content-prompt";
import { externalPolicy } from "@/lib/server/external-search/policy";
import { contentReadPlan } from "@/lib/server/assistant/read-plan";

// Regression seeds from the handover report. These assert routing decisions only:
// they never encode a canned answer for the sentence.
it.each([
  ["你是一只大肥鱼", "chitchat"],
  ["好饿饿，我要次饭饭", "chitchat"],
  ["123456789", "general"],
  ["？？？？", "confusion"],
  ["不对", "correction"],
] as const)(
  "does not turn a conversational turn into a campus search: %s",
  (message, act) => {
    expect(conversationAct(message)).toBe(act);
    const intent = contentIntent(message);
    expect(intent.act).toBe(act);
    expect(intent.active).toBe(false);
    expect(intent.tools).toEqual([]);
  },
);

it("keeps a verifiable campus fact strict and a housing question advisory", () => {
  const rules = contentIntent("广外图书馆借阅规则是什么");
  expect(rules.active).toBe(true);
  expect(rules.tools).toEqual(["search_campus_knowledge"]);
  expect(rules.answerRequirement).toBe("strict");

  const housing = contentIntent("住广外宿舍有什么要注意的事情吗");
  expect(housing.active).toBe(true);
  expect(housing.act).toBe("campus");
  expect(housing.tools).toEqual(["search_campus_knowledge"]);
  expect(housing.answerRequirement).toBe("advisory");
});

it("allows general advice in the answer phase without relaxing campus facts", () => {
  const housing = contentIntent("住广外宿舍有什么要注意的事情吗");
  const rules = contentIntent("广外图书馆借阅规则是什么");
  const context = (content: typeof housing) => ({
    content,
    supplementPolicy: externalPolicy(content.query),
    originIds: [],
    hasLocation: false,
  });
  expect(contentInstructions(context(housing), "answer")).toContain("通用常识");
  expect(contentInstructions(context(housing), "answer")).toContain("普遍适用");
  expect(contentInstructions(context(rules), "answer")).not.toContain(
    "普遍适用",
  );
});

it("tells a feedback turn to explain the previous answer instead of searching", () => {
  expect(directInstructions("confusion")).toContain("不把反馈词当作查询主题");
  expect(directInstructions("correction")).toContain("承认并纠正");
  expect(directInstructions("chitchat")).toContain(
    "普通聊天、情绪交流不需要校园证据",
  );
});

it("routes a facility listing to the map instead of the article corpus", () => {
  // The campus map knows every courier counter; the article corpus has almost
  // nothing. Asking "which" or "where" is a place lookup, so it must not be
  // answered with "no evidence was retrieved".
  const couriers = contentIntent("收快递除了驿站还有别的点吗？");
  expect(couriers.map).toBe(true);
  expect(couriers.active).toBe(false);
  const printers = contentIntent("校内有哪些打印店？");
  expect(printers.map).toBe(true);
  // A fee question is a rule question, not a place lookup.
  const fees = contentIntent("打印店打印一张多少钱？");
  expect(fees.map).toBe(false);
});

it("routes a competition prize question to knowledge, not the event list", () => {
  // "奖金怎么发放" asks about a rule; the event lane answered it with a list of
  // unrelated competitions.
  const intent = contentIntent("学科竞赛的奖金怎么发放？");
  expect(intent.tools).toContain("search_campus_knowledge");
  expect(intent.answerRequirement).toBe("strict");
});

it("routes a bare campus event name to event search, not a refusal", () => {
  const intent = contentIntent("了解下秋之声");
  expect(intent.active).toBe(true);
  expect(intent.tools).toEqual(["search_campus_events"]);
  expect(intent.retrievalQuery).toBe("秋之声");
});

it("orders a recent radar-tag request by publication time, not lexical score", () => {
  const intent = contentIntent("最近有什么计算机相关的竞赛吗");
  expect(intent.recentDiscovery).toBe(true);
  expect(intent.radarCategory).toBe("competition");
  const plan = contentReadPlan(
    ["search_campus_events"],
    "最近有什么计算机相关的竞赛吗",
    externalPolicy("最近有什么计算机相关的竞赛吗"),
    () => false,
    intent.retrievalQuery,
    () => false,
    intent.radarCategory,
    intent.recentDiscovery,
  );
  expect(plan[0]?.input).toMatchObject({
    sort: "published_desc",
    category: "competition",
    limit: 5,
  });
});

it("pages through a recent category list when the user asks for more", () => {
  const history = [
    {
      id: "u1",
      role: "user" as const,
      text: "最近有什么竞赛吗",
      cards: [],
      createdAt: 1,
    },
    {
      id: "a1",
      role: "assistant" as const,
      text: "最近有秋之声、党史知识竞赛。",
      cards: [],
      createdAt: 2,
    },
  ];
  const intent = contentIntent("还有吗", history);
  expect(intent.discoveryFollowup).toBe(true);
  expect(intent.recentDiscovery).toBe(true);
  expect(intent.radarCategory).toBe("competition");
  expect(intent.retrievalQuery).toBe("竞赛");
  const plan = contentReadPlan(
    ["search_campus_events"],
    intent.query,
    externalPolicy(intent.query),
    () => false,
    intent.retrievalQuery,
    () => false,
    intent.radarCategory,
    intent.recentDiscovery,
    intent.discoveryFollowup,
    "2026-10-28",
  );
  expect(plan[0]?.input).toMatchObject({
    sort: "published_desc",
    limit: 5,
    publishedBefore: "2026-10-28",
  });
});

it("locks an event search to the radar category the user named", () => {
  const intent = contentIntent("了解下广外法学院的比赛");
  expect(intent.retrievalQuery).toBe("法学院 比赛");
  expect(intent.radarCategory).toBe("competition");
  const plan = contentReadPlan(
    ["search_campus_events"],
    "了解下广外法学院的比赛",
    externalPolicy("了解下广外法学院的比赛"),
    () => false,
    intent.retrievalQuery,
    () => false,
    intent.radarCategory,
  );
  expect(plan[0]?.input).toMatchObject({
    query: "法学院 比赛",
    category: "competition",
  });
});

it("routes recent culture and sports to the radar tag with five newest", () => {
  const intent = contentIntent("最近的文体活动");
  expect(intent.radarCategory).toBe("culture_sports");
  expect(intent.recentDiscovery).toBe(true);
  const plan = contentReadPlan(
    ["search_campus_events"],
    intent.query,
    externalPolicy(intent.query),
    () => false,
    intent.retrievalQuery,
    () => false,
    intent.radarCategory,
    intent.recentDiscovery,
  );
  expect(plan[0]?.input).toMatchObject({
    sort: "published_desc",
    limit: 5,
  });
});

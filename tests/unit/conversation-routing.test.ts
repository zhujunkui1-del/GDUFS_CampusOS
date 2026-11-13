import { expect, it } from "vitest";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import { titleLike } from "@/lib/server/assistant/intent";
import { navigationIntent } from "@/domain/agent/navigation-intent";
import { searchCampusPlaces as scanPlaces } from "@/features/campus-map/data/campus";
import { conversationAct } from "@/lib/server/assistant/conversation-act";
import {
  contentInstructions,
  directInstructions,
} from "@/lib/server/assistant/content-prompt";
import { externalPolicy } from "@/lib/server/external-search/policy";
import { contentReadPlan } from "@/lib/server/assistant/read-plan";
import { buildQueryPlan as buildPlan } from "@/lib/retrieval/query-plan";

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

it("answers a small-talk question about the assistant without a campus search", () => {
  // The second question set included "你好呀，你今天心情怎么样", which used to
  // be treated as a campus question and searched the article corpus.
  const intent = contentIntent("你好呀，你今天心情怎么样");
  expect(conversationAct("你好呀，你今天心情怎么样")).toBe("chitchat");
  expect(intent.active).toBe(false);
  expect(intent.tools).toEqual([]);
  // A state word on a campus subject is still a campus question.
  expect(contentIntent("你觉得宿舍怎么样").active).toBe(true);
});

it("does not read a request for advice as an article title", () => {
  // "…有什么除潮的办法" ends with 办法, so the title heuristic claimed it and
  // the answer became "当前公开资料中未找到这篇文章".
  expect(titleLike("宿舍太潮湿了，有什么除潮的办法")).toBe(false);
  expect(titleLike("关于开展2026年校园歌手大赛的通知")).toBe(true);
  const intent = contentIntent("宿舍太潮湿了，有什么除潮的办法");
  expect(intent.answerRequirement).toBe("advisory");
  expect(intent.articleLookup).toBe(false);
});

it("keeps a practical question advisory while a policy stays strict", () => {
  expect(contentIntent("大一新生该怎么安排时间").answerRequirement).toBe(
    "advisory",
  );
  expect(contentIntent("宿舍钥匙丢了怎么办").answerRequirement).toBe(
    "advisory",
  );
  // A named rule still has to be supported by a real document.
  expect(contentIntent("缓考要怎么申请").answerRequirement).toBe("strict");
  expect(contentIntent("广外图书馆借阅规则是什么").answerRequirement).toBe(
    "strict",
  );
});

it("does not turn a movement compound into a library route", () => {
  // 「图书馆可以带包进去吗」 contains 去 inside 进去; the map tool would look
  // for a destination and answer NOT_FOUND instead of the library rule.
  const intent = contentIntent("图书馆可以带包进去吗");
  expect(intent.map).toBe(false);
  expect(intent.tools).toEqual(["search_campus_knowledge"]);
  expect(navigationIntent("我想去图书馆").routeQuestion).toBe(true);
});

it("sends a facility question to the map only when the service word is a real place", () => {
  // 「打印照片」 is not a print shop; sending it to the map made search_places
  // fail and the whole turn answer nothing.
  expect(scanPlaces("打印照片")).toEqual([]);
  expect(contentIntent("校园里有照相馆或者打印照片的地方吗").map).toBe(true);
  expect(contentIntent("校内有哪些打印店？").map).toBe(true);
  expect(contentIntent("校内有快递点吗").map).toBe(true);
});

it("answers a safety question without waiting for campus evidence", () => {
  // The corpus has no article on being followed, so a strict gate refused to
  // answer at all. The answer is general knowledge, not a campus fact.
  for (const message of [
    "被人跟踪骚扰可以找谁帮忙",
    "学校附近有人尾随我",
    "宿舍着火了怎么办",
  ]) {
    const intent = contentIntent(message);
    expect(intent.answerRequirement).toBe("open");
    expect(intent.tools).toEqual([]);
  }
  // A routine rule question still needs a real document.
  expect(contentIntent("宿舍可以自己装路由器吗").answerRequirement).toBe(
    "strict",
  );
});

it("treats a complaint about the previous answer as feedback, not a topic", () => {
  expect(conversationAct("好敷衍啊，你就这么回答问题吗")).toBe("confusion");
  expect(conversationAct("你怎么这么敷衍")).toBe("confusion");
  const intent = contentIntent("好敷衍啊，你就这么回答问题吗");
  expect(intent.tools).toEqual([]);
  // A campus subject in the complaint is still a campus question.
  expect(conversationAct("图书馆的回答太糊弄了")).toBe("campus");
});

it("drops the instruction to repeat from the search subject", () => {
  const plan = buildPlan("那借书的规矩来着，你再说一遍");
  expect(plan.topics.map((t) => t.id)).toEqual(["borrowing"]);
  expect(plan.modifiers.map((m) => m.original)).not.toContain("你再说一遍");
  // 「规矩来着」 is a spoken clause, not a term the article writes.
  expect(plan.modifiers.every((m) => m.hard === false)).toBe(true);
});

it("keeps a fee clause as a hint instead of a hard filter", () => {
  // "书逾期了要交" and "违约要赔" are how the question is phrased; the
  // articles write 逾期 and 违约金.
  for (const message of ["图书馆的书逾期了要交多少钱", "三方协议违约要赔多少钱"]) {
    const plan = buildPlan(message);
    expect(plan.modifiers.length).toBeGreaterThan(0);
    expect(plan.modifiers.every((m) => m.hard === false)).toBe(true);
  }
});

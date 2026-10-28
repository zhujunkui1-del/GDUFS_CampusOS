import { expect, it } from "vitest";
import {
  externalPolicy,
  supplementRequired,
} from "@/lib/server/external-search/policy";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import {
  evidenceFallback,
  expressionConflicts,
} from "@/lib/server/assistant/grounding";
import { ContentSearchResultSchema } from "@/domain/retrieval/skills";
import { vi } from "vitest";
import { meteredClient } from "@/lib/server/assistant/model-run";
import { AssistantStore } from "@/lib/server/assistant/store";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { MockModelProvider } from "../fixtures/mock-model";
import type { ModelSnapshot } from "@/domain/models/contracts";
import { contentInstructions } from "@/lib/server/assistant/content-prompt";
import { matchesQueryFocus } from "@/lib/retrieval/query-focus";
import { publicQuery } from "@/lib/server/assistant/read-plan";

const unrelated = ContentSearchResultSchema.parse({
  purpose: "knowledge",
  query: "有什么好吃的吗",
  now: "2026-10-28T00:00:00Z",
  timeZone: "Asia/Shanghai",
  hits: [],
  activities: [],
  knowledge: [],
  metrics: {
    rowsRead: 0,
    rowsWritten: 0,
    queries: 0,
    durationMs: 0,
    candidateChunks: 0,
    usageAvailable: true,
  },
  indexVersion: "campus-fts-v1",
  method: "fts5_keywords_and_domain_expansion",
  warnings: [],
});
const dormHit = {
  documentId: "fixture-dorm",
  chunkId: "fixture",
  title: "宿舍生活指南",
  sourceId: "fixture",
  sourceName: "隔离来源",
  originalUrl: "https://example.invalid/dorm",
  publishedAt: null,
  contentSnippet: "宿舍隔音不错，入住体验很好。",
  startOffset: 0,
  endOffset: 20,
  evidenceBasis: "normalized_text",
  evidenceType: "full_text",
  bodyAvailable: true,
  bodyPartial: false,
  relevanceScore: 1,
  rankingReasons: [],
  classificationState: "unknown",
  radarCategory: null,
  knowledgeCategory: null,
  classificationOrigin: "fixture",
  contentRevision: 1,
  inputHash: "fixture",
  documentVersion: 1,
  publicAvailable: true,
  validity: "unknown",
  official: false,
  readable: true,
  linkedSources: [],
};
const dorm = ContentSearchResultSchema.parse({ ...unrelated, hits: [dormHit] });
it("keeps the CampusOS campus context for the exact unqualified food request", () => {
  expect(contentIntent("有什么好吃的吗").query).toContain("广外");
});
it("does not let dormitory experience suppress a required food search", () => {
  expect(supplementRequired(externalPolicy("广外有什么好吃的"), [dorm])).toBe(
    true,
  );
});
it("does not accept an unrelated dormitory body as evidence for food recommendations", () => {
  expect(
    evidenceFallback([dorm], undefined, externalPolicy("广外有什么好吃的")),
  ).toBeDefined();
});
it("does not turn a whale persona into a claim of visiting or eating at the canteen", () => {
  expect(
    expressionConflicts("本鱼摸鱼逛遍南校食堂，给你捋捋", "daily", 1),
  ).toContain("fabricated_personal_experience");
  expect(
    expressionConflicts("本鱼没有吃过，只整理作者分享", "daily", 1),
  ).not.toContain("fabricated_personal_experience");
});
it("rejects the reported overseas and book evidence, without filtering a real canteen recommendation", () => {
  expect(
    matchesQueryFocus(
      "food",
      {
        title: "GESP考试-广外大学城考点指南",
        contentSnippet: "学校有食堂，周边贝岗商圈距离一公里。",
      },
      "广外有什么好吃的",
    ),
  ).toBe(false);
  expect(
    matchesQueryFocus(
      "food",
      {
        title: "使用指南｜广外校园卡充值全攻略",
        contentSnippet: "饭堂支持校园卡消费。",
      },
      "广外有什么好吃的",
    ),
  ).toBe(false);
  expect(
    matchesQueryFocus(
      "food",
      {
        title: "【云享·留学】从广外到LSE",
        contentSnippet: "LSE食堂不好吃，某派很好吃",
      },
      "广外南校有什么好吃的",
    ),
  ).toBe(false);
  expect(
    matchesQueryFocus("food", {
      title: "新书速递｜馆藏上新",
      contentSnippet: "《这本书很好吃》，美食与故乡味道",
    }),
  ).toBe(false);
  expect(
    matchesQueryFocus(
      "food",
      { title: "南校一饭餐品推荐", contentSnippet: "一饭二楼的饭菜口味介绍" },
      "广外南校有什么好吃的",
    ),
  ).toBe(true);
  expect(
    matchesQueryFocus(
      "food",
      { title: "白云山校区饭堂介绍", contentSnippet: "口味推荐" },
      "广外南校有什么好吃的",
    ),
  ).toBe(false);
});
it("uses compact campus and venue keywords while retaining the explicitly requested campus", () => {
  expect(publicQuery(contentIntent("有什么好吃的吗").query)).toBe(
    "广外 南校 食堂",
  );
  expect(publicQuery(contentIntent("北校一饭有什么好吃的").query)).toBe(
    "广外 北校 一饭",
  );
  expect(
    publicQuery(contentIntent("南校一饭有没有不辣的素食推荐").query),
  ).toContain("不辣");
  expect(
    publicQuery(contentIntent("南校一饭有没有不辣的素食推荐").query),
  ).toContain("素食");
});
it("does not carry planning obligations into the answer phase", () => {
  const content = contentIntent("有什么好吃的吗");
  const context = {
    content,
    supplementPolicy: externalPolicy(content.query),
    originIds: [],
    hasLocation: false,
  };
  expect(contentInstructions(context, "plan")).toContain("必须实际检索");
  expect(contentInstructions(context, "answer")).not.toContain("必须实际检索");
  expect(contentInstructions(context, "answer")).not.toContain(
    "search_external_campus_info",
  );
  expect(contentInstructions(context, "answer")).toContain("不询问是否要搜索");
});
it("never streams a pseudo tool call to the user and repairs it without executing text as a function", async () => {
  const f = sqliteD1();
  try {
    const store = new AssistantStore(f.db);
    vi.spyOn(store, "running").mockResolvedValue();
    const xml =
      "<tool_call><function=search_external_campus_info><parameter=query>广外 食堂</parameter></function></tool_call>";
    const reply = {
      toolCalls: [],
      finishReason: "stop" as const,
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    };
    const client = new MockModelProvider([
      { ...reply, content: xml },
      { ...reply, content: "已取得相关学生体验，请查看对应来源。" },
    ]);
    const snapshot: ModelSnapshot = {
      source: "platform",
      provider: "stepfun",
      model: "fixture",
      policyVersion: "fixture",
      testedAt: "2026-10-28T00:00:00Z",
      capabilities: {
        toolCalling: true,
        jsonObject: true,
        strictJsonSchema: false,
      },
    };
    const bounded = meteredClient(
      client,
      snapshot,
      store,
      "fixture",
      "fixture",
      () => true,
    );
    const onText = vi.fn();
    const result = await bounded.client.generateWithTools({
      messages: [{ role: "user", content: "fixture" }],
      tools: [],
      maxTokens: 1024,
      signal: new AbortController().signal,
      onText,
    });
    expect(result.content).not.toContain("<tool_call>");
    expect(onText.mock.calls.flat().join("")).not.toContain("<tool_call>");
    expect(client.requests).toHaveLength(2);
    expect(client.requests[1].tools).toEqual([]);
  } finally {
    f.close();
  }
});
it("stops after one failed protocol repair without leaking either attempt", async () => {
  const f = sqliteD1();
  try {
    const store = new AssistantStore(f.db);
    vi.spyOn(store, "running").mockResolvedValue();
    const reply = {
      content:
        "<tool_call><function=search_external_campus_info></function></tool_call>",
      toolCalls: [],
      finishReason: "stop" as const,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
    const client = new MockModelProvider([reply, reply]);
    const snapshot: ModelSnapshot = {
      source: "platform",
      provider: "stepfun",
      model: "fixture",
      policyVersion: "fixture",
      testedAt: "2026-10-28T00:00:00Z",
      capabilities: {
        toolCalling: true,
        jsonObject: true,
        strictJsonSchema: false,
      },
    };
    const bounded = meteredClient(
      client,
      snapshot,
      store,
      "fixture",
      "fixture",
      () => true,
    );
    const onText = vi.fn();
    await expect(
      bounded.client.generateWithTools({
        messages: [{ role: "user", content: "fixture" }],
        tools: [],
        maxTokens: 1024,
        signal: new AbortController().signal,
        onText,
      }),
    ).rejects.toThrow("回复生成异常");
    expect(onText).not.toHaveBeenCalled();
    expect(client.requests).toHaveLength(2);
  } finally {
    f.close();
  }
});

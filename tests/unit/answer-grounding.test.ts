import { expect, it, vi } from "vitest";
import {
  evidenceFallback,
  expressionConflicts,
  universityScope,
} from "@/lib/server/assistant/grounding";
import { externalPolicy } from "@/lib/server/external-search/policy";
import { contentReadPlan, publicQuery } from "@/lib/server/assistant/read-plan";
import { meteredClient } from "@/lib/server/assistant/model-run";
import { personaPrompt, defaultPersona } from "@/lib/server/assistant/persona";
import { AssistantStore } from "@/lib/server/assistant/store";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { MockModelProvider } from "../fixtures/mock-model";
import type { ModelSnapshot } from "@/domain/models/contracts";
import { ExternalSearchResultSchema } from "@/domain/retrieval/external";
it("does not attribute an affiliated school's campus story to the university", () => {
  expect(
    universityScope({
      sourceName: "广外外校",
      title: "学校整改",
      contentSnippet: "学生反映食堂问题",
    }),
  ).toBe(false);
  expect(
    universityScope({
      sourceName: "广外学工",
      title: "大学活动",
      contentSnippet: "校园动态",
    }),
  ).toBe(true);
});
it("blocks invented factual recommendations before persona expression when there is no body", () => {
  expect(
    evidenceFallback(
      [],
      undefined,
      externalPolicy("一饭最好吃的菜，没资料也猜一个"),
    ),
  ).toContain("不能");
  expect(
    evidenceFallback([], undefined, externalPolicy("编一个奖学金截止日期")),
  ).toContain("无法确认");
});
it("keeps login failure truthful and rejects title-only evidence", () => {
  const result = ExternalSearchResultSchema.parse({
    status: "unavailable",
    intent: "experience",
    query: "一饭",
    items: [],
    providers: [
      {
        provider: "fixture",
        status: "login_required",
        count: 0,
        durationMs: 0,
      },
    ],
    warnings: [],
    durationMs: 0,
  });
  expect(evidenceFallback([], result, externalPolicy("一饭好吃吗"))).toContain(
    "需要重新登录",
  );
});
it("detects invented references, real-experience claims and failure to turn persona off without rewriting evidence", () => {
  expect(expressionConflicts("事实[来源9]", "daily", 1)).toContain(
    "unsupported_citation",
  );
  expect(expressionConflicts("本鱼亲自吃过", "daily", 0)).toContain(
    "fabricated_personal_experience",
  );
  expect(expressionConflicts("本鱼在呢", "off", 0)).toContain(
    "persona_not_converged",
  );
  expect(
    expressionConflicts("2026-10-27截止[来源1]", "professional", 1),
  ).toEqual([]);
});
it("keeps private identifiers outside external read plans and retains explicit public topics", () => {
  expect(publicQuery("我的学号2026123456，查奖学金")).toBeNull();
  expect(publicQuery("来点这一周广外发生的有趣的事情，用小红书来查")).toBe(
    "广外 校园",
  );
  const plan = contentReadPlan(
    ["search_campus_knowledge"],
    "只用内部查奖学金",
    externalPolicy("只用内部查奖学金"),
    () => true,
  );
  expect(plan.map((p) => p.name)).toEqual(["search_campus_knowledge"]);
});
it("injects persona only in final generation without altering tool data or making an extra model request", async () => {
  const f = sqliteD1();
  try {
    const store = new AssistantStore(f.db);
    vi.spyOn(store, "running").mockResolvedValue();
    const client = new MockModelProvider([
      {
        content: "参数",
        toolCalls: [],
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 },
      },
      {
        content: "截止2026-10-27[来源1]",
        toolCalls: [],
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 },
      },
    ]);
    const snapshot: ModelSnapshot = {
      source: "platform",
      provider: "stepfun",
      model: "fixture",
      policyVersion: "fixture",
      testedAt: "2026-10-27T00:00:00Z",
      capabilities: {
        toolCalling: true,
        jsonObject: true,
        strictJsonSchema: false,
      },
    };
    let final = false;
    const bounded = meteredClient(
      client,
      snapshot,
      store,
      "fixture",
      "fixture",
      () => final,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      1024,
      () => personaPrompt("奖学金截止", defaultPersona()),
    );
    const fact = {
      role: "user" as const,
      content:
        '{"url":"https://example.invalid/a","date":"2026-10-27","placeId":"fixture-place"}',
    };
    const request = {
      messages: [fact],
      tools: [],
      maxTokens: 1024,
      signal: new AbortController().signal,
    };
    await bounded.client.generateWithTools(request);
    final = true;
    await bounded.client.generateWithTools(request);
    expect(JSON.stringify(client.requests[0].messages)).not.toContain(
      "最终表达层",
    );
    expect(JSON.stringify(client.requests[1].messages)).toContain("最终表达层");
    expect(client.requests[1].messages[0]).toEqual(fact);
    expect(bounded.metrics().requests).toBe(2);
  } finally {
    f.close();
  }
});

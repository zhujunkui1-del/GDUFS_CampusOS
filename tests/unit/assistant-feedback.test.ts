import { expect, it, vi } from "vitest";
import {
  containsToolProtocol,
  stripToolProtocol,
} from "@/lib/assistant-output";
import { requiresPlaceLookup } from "@/lib/server/assistant/intent";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import { dialogueReply } from "@/lib/server/assistant/dialogue";
import { evidenceFallback } from "@/lib/server/assistant/grounding";
import { rosterEvidenceAnswer } from "@/lib/server/assistant/evidence-answer";
import { contentInstructions } from "@/lib/server/assistant/content-prompt";
import {
  externalPolicy,
  supplementRequired,
} from "@/lib/server/external-search/policy";
import { registerExternalSearch } from "@/lib/server/external-search/skill";
import type { ProviderResult } from "@/lib/server/external-search/providers";
import { SkillRegistry } from "@/lib/server/agent/skill-registry";
it("resolves canteen aliases and named facilities through the map skill", () => {
  for (const message of [
    "又康超市在哪",
    "一饭在哪",
    "二饭在哪",
    "校医院在哪里",
  ])
    expect(requiresPlaceLookup(message)).toBe(true);
  expect(contentIntent("又康超市在哪").active).toBe(false);
  expect(contentIntent("一饭在哪").active).toBe(false);
});
it("answers abuse as feedback instead of searching it", () => {
  const reply = dialogueReply("你妈似了");
  expect(reply).toBeDefined();
  expect(reply).toContain("本鱼");
  expect(contentIntent("你妈似了").active).toBe(false);
});
it("uses persona tone instead of a bureaucratic refusal when no body exists", () => {
  const policy = externalPolicy("广外有什么大型体育赛事");
  const playful = evidenceFallback([], undefined, policy, true);
  expect(playful).toContain("本鱼");
  expect(playful).not.toContain("本次没有取得足以回答问题的正文证据");
  const neutral = evidenceFallback([], undefined, policy);
  expect(neutral).not.toContain("只有标题、链接或日期");
});
it("keeps another region's same-named entity out of campus evidence", async () => {
  const relay = vi.fn(async (): Promise<ProviderResult> => ({
    provider: "isolated",
    status: "ok" as const,
    durationMs: 1,
    items: [
      {
        title: "北京市西城区广外医院",
        originalUrl: "https://www.bjxch.gov.cn/hospital",
        sourceName: "北京市西城区人民政府",
        platform: "web",
        snippet: "北京市西城区广外医院位于广安门外。",
        authority: "unverified",
        evidenceKind: "page_excerpt",
        publishedAt: null,
        retrievedAt: "2026-10-29T00:00:00Z",
        searchMode: "web",
        canConfirmAdministrativeFacts: false,
      },
      {
        title: "讲座预告：人工智能与外语教学",
        originalUrl: "https://www.gdufs.edu.cn/lecture",
        sourceName: "广东外语外贸大学",
        platform: "web",
        snippet: "广东外语外贸大学将于本周举办讲座。",
        authority: "official",
        evidenceKind: "page_excerpt",
        publishedAt: null,
        retrievedAt: "2026-10-29T00:00:00Z",
        searchMode: "web",
        canConfirmAdministrativeFacts: true,
      },
    ],
  }));
  const policy = externalPolicy("广外最近有什么讲座");
  const registry = registerExternalSearch(
    new SkillRegistry(),
    policy,
    {
      relay,
    },
    () => true,
  );
  const result = await registry.get("search_external_campus_info")!.run(
    { query: "最近讲座", gap: "freshness_check", limit: 3 },
    {
      requestId: "fixture",
      sessionId: "fixture",
      user: null,
      permissions: [],
      campusId: "gdufs_university_town",
    },
  );
  const items = result.ok
    ? (result.data as { items: { originalUrl: string }[] }).items
    : [];
  expect(items.map((item) => item.originalUrl)).toEqual([
    "https://www.gdufs.edu.cn/lecture",
  ]);
});
it("asks for a numbered, direct answer instead of an excerpt frame", () => {
  const content = contentIntent("广外最近有哪些讲座");
  const instructions = contentInstructions(
    {
      content,
      supplementPolicy: externalPolicy(content.query),
      originIds: [],
      hasLocation: false,
    },
    "answer",
  );
  expect(instructions).toContain("Markdown标题、段落、列表或对比表");
  expect(instructions).toContain("直接回答，再给关键依据");
  expect(instructions).toContain("不用“来源：”或长URL清单");
  expect(instructions).not.toContain("回答末尾写“来源：”");
});
it("retrieves discovery questions with the core topic instead of the whole phrase", () => {
  expect(
    contentIntent("广外曾经或最近有什么大型体育赛事吗").retrievalQuery,
  ).toBe("广外 体育 比赛");
  expect(contentIntent("举3个最近时间段的讲座").retrievalQuery).toBe("讲座");
  const recent = contentIntent("查询几个最近的可报名的讲座");
  expect(recent.retrievalQuery).toBe("讲座");
  expect(recent.radarCategory).toBe("lecture");
  expect(recent.timeWindow?.role).toBe("registration");
  const recentCompetition = contentIntent("最近有什么计算机相关的竞赛吗");
  expect(recentCompetition.recentDiscovery).toBe(true);
  expect(recentCompetition.radarCategory).toBe("competition");
  expect(recentCompetition.timeWindow).toBeUndefined();
  const map = contentIntent("带我去南苑11栋", [
    { id: "u1", role: "user", text: "2026年的秋之声什么时候举行", cards: [] },
    { id: "a1", role: "assistant", text: "秋之声...", cards: [] },
  ]);
  expect(map.active).toBe(false);
  expect(map.map).toBe(true);
  expect(map.query).toBe("带我去南苑11栋");
  expect(contentIntent("广外图书馆借阅规则是什么").retrievalQuery).toBe(
    "广外图书馆借阅规则是什么",
  );
});
it("treats a roster question as needing official supplementation", () => {
  const roster = externalPolicy("举几位广外的云山学者");
  expect(roster.needsRoster).toBe(true);
  expect(
    supplementRequired(roster, [
      {
        hits: [
          {
            bodyAvailable: true,
            contentSnippet:
              "英语教育学院邀请云山学者Ali Derakhshan教授开展讲座。",
          },
        ],
        activities: [],
      },
    ]),
  ).toBe(true);
  expect(externalPolicy("图书馆借阅规则").needsRoster).toBe(false);
});
it("retrieves a roster question even when the school name is omitted", () => {
  const intent = contentIntent("举几位云山学者");
  expect(intent.act).toBe("campus");
  expect(intent.active).toBe(true);
  expect(intent.tools).toEqual(["search_campus_knowledge"]);
});
it("renders one extractive roster list instead of generated prose", () => {
  const card = {
    kind: "source" as const,
    documentId: "roster-fixture",
    title: "云山学者-经济贸易学院",
    sourceName: "经济贸易学院",
    originalUrl: "https://jingmao.gdufs.edu.cn/szdw/ysxz.htm",
    publishedAt: null,
    snippet: "云山学者\n- 唐凯\n- 李建成\n- 徐明\n- 刘诗源\n- 何轩\n- 于斌斌",
    evidenceType: "full_text" as const,
    classificationState: "unknown" as const,
    validity: "unknown" as const,
    readable: true,
  };
  const answer = rosterEvidenceAnswer([card], true);
  expect(answer).toContain("本鱼按原文名单页整理");
  expect(answer).toContain("1. 唐凯[1]");
  expect(answer).toContain("6. 于斌斌[1]");
  expect(answer).not.toContain("来源：");
  expect(answer).not.toContain("https://jingmao.gdufs.edu.cn/szdw/ysxz.htm");
  expect(rosterEvidenceAnswer([], true)).toBeUndefined();
});

it("treats bare tool names in prose as normal language", () => {
  const prose = "本鱼用 search_campus_knowledge 查了体育场馆，信息如下。";
  expect(containsToolProtocol(prose)).toBe(false);
});

it("detects and strips text-mode tool-call leakage", () => {
  const simulated = 'search_campus_knowledge({"query":"体育场馆"})';
  expect(containsToolProtocol(simulated)).toBe(true);
  expect(stripToolProtocol(simulated)).toBe("");
  expect(
    containsToolProtocol("<tool_call>search_places</tool_call>正常答案"),
  ).toBe(true);
  expect(
    stripToolProtocol("<tool_call>search_places</tool_call>正常答案"),
  ).toBe("正常答案");
  expect(
    containsToolProtocol('{"tool_calls":[{"function":"control_map"}]}'),
  ).toBe(true);
});

it("treats an Arabic-numbered roster request as a roster question", () => {
  expect(externalPolicy("请举3个广外的云山学者").needsRoster).toBe(true);
  expect(externalPolicy("列出两位广外的教授").needsRoster).toBe(true);
  expect(externalPolicy("介绍这个学者").needsRoster).toBe(false);
});

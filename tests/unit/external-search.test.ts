import { it, expect, vi } from "vitest";
import {
  externalPolicy,
  isOfficialCampusUrl,
  supplementRequired,
} from "@/lib/server/external-search/policy";
import {
  searchWeb,
  searchXiaohongshu,
  parseWebResults,
} from "@/lib/server/external-search/providers";
import { registerExternalSearch } from "@/lib/server/external-search/skill";
import { SkillRegistry } from "@/lib/server/agent/skill-registry";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import { contentReadPlan } from "@/lib/server/assistant/read-plan";
import type { SkillContext } from "@/domain/skills/contracts";
const context: SkillContext = {
  requestId: "test",
  sessionId: "test",
  user: null,
  campusId: "gdufs_university_town",
  permissions: [],
};
it.each([
  ["广外图书馆借阅规则是什么？", "official", false],
  ["广外哪个食堂的饭好吃？", "experience", true],
  ["南苑宿舍住起来怎么样？", "mixed", true],
  ["最近学校有什么活动？", "events", true],
  ["奖学金申请截止日期是什么时候？", "official", false],
] as const)(
  "routes question type independently of retrieval misses: %s",
  (q, intent, xhs) => {
    const p = externalPolicy(q);
    expect(p.intent).toBe(intent);
    expect(p.useXiaohongshu).toBe(xhs);
    expect(supplementRequired(p, [])).toBe(true);
  },
);
it.each([
  "从南苑7栋去图书馆",
  "切换3D",
  "请清除路线",
  "定位图书馆",
  "你好",
  "南苑7栋",
  "帮我找图书馆",
  "那里",
])("preserves map/greeting routing: %s", (q) => {
  expect(contentIntent(q).active).toBe(false);
});
it("experience questions still search internal content first", () =>
  expect(contentIntent("广外哪个食堂好吃？").tools).toEqual([
    "search_campus_knowledge",
  ]));
it("supplements a campus payment question when evidence only names the collecting department or another campus", () => {
  const query = "广外南校宿舍水电费怎么交";
  const policy = externalPolicy(query);
  expect(contentIntent(query).tools).toContain("search_campus_knowledge");
  expect(policy.intent).toBe("official");
  const reads = contentReadPlan(
    ["search_campus_knowledge"],
    query,
    policy,
    () => true,
  );
  expect(
    reads
      .filter((read) => read.name === "search_campus_knowledge")
      .map((read) => read.input),
  ).toMatchObject([{ query }]);
  const north = "广外白云山校区宿舍水电费怎么交";
  expect(
    contentReadPlan(
      ["search_campus_knowledge"],
      north,
      externalPolicy(north),
      () => true,
    )
      .filter((read) => read.name === "search_campus_knowledge")
      .map((read) => read.input),
  ).toMatchObject([{ query: north }]);
  const both = "广外宿舍水电费怎么交";
  expect(
    contentReadPlan(
      ["search_campus_knowledge"],
      both,
      externalPolicy(both),
      () => true,
    )
      .slice(0, 2)
      .map((read) => read.input),
  ).toMatchObject([
    { query: expect.stringContaining("大学城校区") },
    { query: expect.stringContaining("白云山校区") },
  ]);
  const evaluate = (...snippets: string[]) =>
    supplementRequired(policy, [
      {
        hits: snippets.map((contentSnippet) => ({
          title: "后勤服务指南",
          bodyAvailable: true,
          official: true,
          contentSnippet,
        })),
        activities: [],
      },
    ]);
  expect(evaluate("大学城校区宿舍水电费由公寓中心收缴。")).toBe(true);
  expect(evaluate("白云山校区宿舍水电线上充值渠道：数智广外。")).toBe(true);
  expect(evaluate("大学城校区的宿舍热水费。进入校园卡选择南校热水充值。")).toBe(
    true,
  );
  expect(
    evaluate("大学城校区水、电IC卡充值服务。充值服务地址：学生宿舍1栋。"),
  ).toBe(false);
  expect(
    evaluate(
      "大学城校区水、电IC卡充值服务。充值服务地址：学生宿舍1栋。",
      "白云山校区宿舍水电线上充值渠道：数智广外。",
    ),
  ).toBe(false);
});
it("only exact official hosts can confirm administrative sources", () => {
  expect(isOfficialCampusUrl("https://lib.gdufs.edu.cn/rules")).toBe(true);
  for (const url of [
    "https://gdufs.edu.cn.evil.test/a",
    "https://evilgdufs.edu.cn/a",
    "http://lib.gdufs.edu.cn/a",
    "https://x:y@gdufs.edu.cn/a",
    "https://gdufs.edu.cn:99/a",
  ])
    expect(isOfficialCampusUrl(url)).toBe(false);
});
it("disabling external search retains internal retrieval", () => {
  expect(externalPolicy("只用内部查食堂好吃").active).toBe(false);
  expect(contentIntent("只用内部查食堂好吃").tools).toEqual([
    "search_campus_knowledge",
  ]);
});
it("optional search credentials go only to the fixed provider header", async () => {
  const f = vi.fn<typeof fetch>().mockResolvedValue(reply("No results"));
  await searchWeb(
    "topic",
    externalPolicy("topic"),
    2,
    undefined,
    f,
    false,
    "fixture-search-key",
  );
  expect(f.mock.calls[0][0]).toBe("https://mcp.exa.ai/mcp");
  expect(f.mock.calls[0][1]?.headers).toHaveProperty(
    "x-api-key",
    "fixture-search-key",
  );
  expect(String(f.mock.calls[0][1]?.body)).not.toContain("fixture-search-key");
});
function reply(text: string) {
  return new Response(
    "event: message\ndata: " +
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text }] },
      }) +
      "\n\n",
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
it("official search scopes the query and retains excerpt provenance, with no credentials", async () => {
  const f = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      reply(
        "Title: 图书借阅规则\nURL: https://lib.gdufs.edu.cn/rules\nPublished: 2023-11-15\nHighlights:\n广外读者凭本人借阅证借书。",
      ),
    )
    .mockResolvedValueOnce(
      reply(
        "Title: 图书借阅规则\nURL: https://lib.gdufs.edu.cn/rules\nText:\n广外读者凭本人借阅证借书。",
      ),
    );
  const r = await searchWeb(
    "图书馆借阅规则",
    externalPolicy("图书馆借阅规则"),
    3,
    undefined,
    f,
  );
  expect(r.status).toBe("ok");
  expect(r.items[0]).toMatchObject({
    authority: "official",
    evidenceKind: "page_excerpt",
    canConfirmAdministrativeFacts: true,
    publishedAt: "2023-11-15",
  });
  const req = f.mock.calls[0][1]!;
  expect(String(req.body)).toContain("site:gdufs.edu.cn");
  expect(req.headers).not.toHaveProperty("Authorization");
  expect(req.redirect).toBe("manual");
});
it("filters off-topic social results and profile pages instead of inventing a campus recommendation", async () => {
  const f = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      reply(
        "Title: 香港食记\nURL: https://www.xiaohongshu.com/explore/abc\nHighlights:\n香港海港酒家好吃。",
      ),
    );
  const r = await searchWeb(
    "广外食堂",
    externalPolicy("广外哪个食堂好吃"),
    3,
    undefined,
    f,
    true,
  );
  expect(r.items).toEqual([]);
  expect(r.status).toBe("empty");
});
it("malformed provider data and rate limiting remain failures, not no-results claims", async () => {
  expect(
    (
      await searchWeb(
        "广外",
        externalPolicy("广外政策"),
        3,
        undefined,
        vi.fn<typeof fetch>().mockResolvedValue(reply("unexpected shape")),
      )
    ).status,
  ).toBe("unavailable");
  expect(
    (
      await searchWeb(
        "广外",
        externalPolicy("广外政策"),
        3,
        undefined,
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("", { status: 429 })),
      )
    ).status,
  ).toBe("rate_limited");
  expect(
    parseWebResults(
      "Title: a\nURL: https://gdufs.edu.cn/a\nPublished: nonsense\nText:\nbody",
    )[0].published,
  ).toBeNull();
});
it("gateway is server-configured and login failure cannot masquerade as successful XHS search", async () => {
  const f = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ status: "login_required", items: [] }));
  expect(
    (await searchXiaohongshu("广外食堂", 3, {}, undefined, f)).status,
  ).toBe("not_configured");
  expect(f).not.toHaveBeenCalled();
  const r = await searchXiaohongshu(
    "广外食堂",
    3,
    { gatewayUrl: "https://search.example.test", gatewayToken: "test-only" },
    undefined,
    f,
  );
  expect(r.status).toBe("login_required");
  expect(String(f.mock.calls[0][0])).toBe(
    "https://search.example.test/v1/search",
  );
  expect(
    (
      await searchXiaohongshu(
        "广外",
        3,
        { gatewayUrl: "http://localhost", gatewayToken: "test-only" },
        undefined,
        f,
      )
    ).status,
  ).toBe("unavailable");
});
it("Skill enforces internal-first and bounded four-search execution, with no database writes", async () => {
  const p = externalPolicy("奖学金截止日期");
  const denied = registerExternalSearch(
    new SkillRegistry(),
    p,
    { webEnabled: false },
    () => false,
  ).get("search_external_campus_info")!;
  await expect(
    denied.run({ query: "广外奖学金截止", gap: "no_internal_answer" }, context),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const skill = registerExternalSearch(
    new SkillRegistry(),
    p,
    { webEnabled: false },
    () => true,
  ).get("search_external_campus_info")!;
  expect(skill.timeoutMs).toBe(30000);
  const result = await skill.run(
    { query: "广外奖学金截止", gap: "no_internal_answer" },
    context,
  );
  expect(result.ok && result.data).toMatchObject({
    status: "unavailable",
    items: [],
  });
  // A turn may look at several gaps — “compare three papers” needs three
  // queries — but the fourth is the last one.
  for (let i = 0; i < 3; i++)
    await skill.run({ query: "广外奖学金", gap: "missing_detail" }, context);
  await expect(
    skill.run({ query: "广外", gap: "missing_detail" }, context),
  ).rejects.toMatchObject({ code: "RUN_LIMIT_EXCEEDED" });
});
it("a general question keeps its own words and keeps general results", async () => {
  const queries: string[] = [];
  const relay = async (input: { query: string }) => {
    queries.push(input.query);
    return {
      provider: "relay",
      status: "ok" as const,
      durationMs: 1,
      items: [
        {
          title: "Cloudflare D1 is a serverless SQLite database",
          originalUrl: "https://developers.cloudflare.com/d1/",
          sourceName: "Cloudflare",
          platform: "web" as const,
          authority: "unverified" as const,
          evidenceKind: "page_excerpt" as const,
          snippet: "Cloudflare D1 is a serverless SQL database.",
          publishedAt: null,
          retrievedAt: "2026-11-20T00:00:00.000Z",
          searchMode: "public_web" as const,
          canConfirmAdministrativeFacts: false,
        },
      ],
    };
  };
  const skill = registerExternalSearch(
    new SkillRegistry(),
    externalPolicy("Cloudflare D1 是什么？"),
    { relay },
    () => true,
  ).get("search_external_campus_info")!;
  const result = await skill.run(
    { query: "Cloudflare D1 是什么？", gap: "freshness_check" },
    context,
  );
  expect(queries[0]).toBe("Cloudflare D1 是什么？");
  expect(
    result.ok ? (result.data as { items: unknown[] }).items : null,
  ).toHaveLength(1);
});
it("a campus question still scopes the query to the school", async () => {
  const queries: string[] = [];
  const skill = registerExternalSearch(
    new SkillRegistry(),
    externalPolicy("图书馆借阅规则是什么？"),
    {
      relay: async (input) => {
        queries.push(input.query);
        return { provider: "relay", status: "empty", durationMs: 1, items: [] };
      },
    },
    () => true,
  ).get("search_external_campus_info")!;
  await skill.run(
    { query: "图书馆借阅规则是什么？", gap: "no_internal_answer" },
    context,
  );
  expect(queries[0]).toContain("广东外语外贸大学");
});
it("an enumeration is searched once per subject", async () => {
  const queries: string[] = [];
  const skill = registerExternalSearch(
    new SkillRegistry(),
    externalPolicy("Cloudflare、D1、SQLite 分别是什么？"),
    {
      relay: async (input) => {
        queries.push(input.query);
        return { provider: "relay", status: "empty", durationMs: 1, items: [] };
      },
    },
    () => true,
  ).get("search_external_campus_info")!;
  await skill.run(
    { query: "Cloudflare、D1、SQLite 分别是什么？", gap: "no_internal_answer" },
    context,
  );
  // One search per subject, and the ambiguous short name is qualified with its
  // family: “D1” alone returns a camera and a dopamine receptor.
  expect(queries).toEqual([
    "Cloudflare 是什么？",
    "Cloudflare D1 是什么？",
    "SQLite 是什么？",
  ]);
});

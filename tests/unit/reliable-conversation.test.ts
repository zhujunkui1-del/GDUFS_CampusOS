import { expect, it, vi } from "vitest";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import { externalPolicy } from "@/lib/server/external-search/policy";
import { registerExternalSearch } from "@/lib/server/external-search/skill";
import { SkillRegistry } from "@/lib/server/agent/skill-registry";
import { shouldClarifyBareTopic } from "@/lib/server/assistant/intent";
it("routes the reported weekly campus story request as time-bounded content", () => {
  expect(
    contentIntent("来点这一周广外发生的有趣的事情，用小红书来查").tools,
  ).toContain("search_campus_events");
});
it("does not interpret pure frustrated feedback as an unknown named topic", () => {
  expect(shouldClarifyBareTopic("操你妈", false, false, false)).toBe(false);
});
it("keeps verified building detail requests in the existing map skills", () => {
  expect(
    contentIntent(
      "查询南苑7栋的详细资料：它属于哪个区域、有多少层、高约多少米？请先查询地点详情，再按已核实资料回答。",
    ).active,
  ).toBe(false);
  expect(contentIntent("图书馆借阅规则是什么").tools).toContain(
    "search_campus_knowledge",
  );
});
it("actually invokes native XHS for an explicit request even in events mode", async () => {
  const relay = vi.fn(
    async (input: import("@/domain/retrieval/relay").RelayInput) => {
      expect(input.query.length).toBeGreaterThan(0);
      return {
        provider: "isolated-fixture",
        status: "empty" as const,
        items: [],
        durationMs: 0,
      };
    },
  );
  const registry = registerExternalSearch(
    new SkillRegistry(),
    externalPolicy("本周校园活动，用小红书查"),
    { relay },
    () => true,
  );
  await registry.get("search_external_campus_info")!.run(
    { query: "广外 校园", gap: "freshness_check", limit: 3 },
    {
      requestId: "fixture",
      sessionId: "fixture",
      user: null,
      permissions: [],
      campusId: "gdufs_university_town",
    },
  );
  expect(relay.mock.calls.some(([input]) => input.kind === "xiaohongshu")).toBe(
    true,
  );
});

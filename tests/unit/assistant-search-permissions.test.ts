import { expect, it, vi } from "vitest";
import { registerExternalSearch } from "@/lib/server/external-search/skill";
import { externalPolicy } from "@/lib/server/external-search/policy";
import { SkillRegistry } from "@/lib/server/agent/skill-registry";
import { verifiedQueryUnderstanding } from "@/lib/server/assistant/query-understanding";
import { AgentChatRequestSchema } from "@/domain/agent/contracts";

it("defaults old and new clients to no external search", () => {
  expect(
    AgentChatRequestSchema.parse({ message: "请上网查" }).smartSearch,
  ).toBe(false);
  const registry = registerExternalSearch(
    new SkillRegistry(),
    { ...externalPolicy("请上网查广外"), active: false },
    {},
    () => true,
  );
  expect(registry.manifest()).toEqual([]);
});

it("uses only ordinary web transport even when legacy policy asks for native search", async () => {
  const relay = vi
    .fn()
    .mockResolvedValue({
      provider: "web",
      status: "empty",
      items: [],
      durationMs: 1,
    });
  const registry = registerExternalSearch(
    new SkillRegistry(),
    {
      ...externalPolicy("用小红书查广外食堂"),
      active: true,
      useXiaohongshu: true,
    },
    { relay },
    () => true,
  );
  await registry
    .get("search_external_campus_info")!
    .run(
      { query: "广外食堂", gap: "student_experience", limit: 3 },
      {
        requestId: "test",
        sessionId: "guest",
        user: null,
        permissions: [],
        campusId: "gdufs_university_town",
      },
    );
  expect(relay).toHaveBeenCalledTimes(1);
  expect(relay.mock.calls[0][0]).toMatchObject({ kind: "web", onlyXhs: false });
});

it("retains literal entities and years and rejects model-invented query terms", () => {
  const question = "2025年广外三下乡需要申请表吗？";
  const plan = {
    subject: "三下乡",
    entities: [],
    constraints: ["申请表"],
    goal: "requirements",
  };
  expect(verifiedQueryUnderstanding(plan, question).query).toBe(
    "“三下乡” “申请表” 申请表 2025",
  );
  expect(() =>
    verifiedQueryUnderstanding({ ...plan, subject: "交换生" }, question),
  ).toThrow();
});

import { expect, it } from "vitest";
import {
  externalPolicy,
  supplementRequired,
} from "@/lib/server/external-search/policy";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import {
  shouldClarifyBareTopic,
  unmatchedTopicClarification,
} from "@/lib/server/assistant/intent";
import { CampusMapService } from "@/lib/server/maps/campus-map-service";
it("handles the real map service's NOT_FOUND exception before asking about an unmatched topic", () => {
  const service = new CampusMapService();
  const context = {
    requestId: "fixture",
    sessionId: "fixture",
    user: null,
    permissions: [],
    campusId: "gdufs_university_town" as const,
  };
  expect(
    unmatchedTopicClarification(
      "戴建业",
      () =>
        service.search({ query: "戴建业", limit: 1 }, context).matches.length >
        0,
    ),
  ).toContain("戴建业");
  expect(
    unmatchedTopicClarification(
      "图书馆",
      () =>
        service.search({ query: "图书馆", limit: 1 }, context).matches.length >
        0,
    ),
  ).toBeUndefined();
});
it("clarifies an unmatched short name without turning it into a map query", () => {
  expect(shouldClarifyBareTopic("戴建业", false, false, false)).toBe(true);
  expect(shouldClarifyBareTopic("图书馆", false, true, true)).toBe(false);
  expect(shouldClarifyBareTopic("你好", false, false, false)).toBe(false);
  expect(shouldClarifyBareTopic("那里", false, false, true)).toBe(false);
  expect(shouldClarifyBareTopic("奖学金", true, false, false)).toBe(false);
});

it.each([
  "广外南校的首席专家有哪些人",
  "戴建业是广外的首席专家吗",
  "这位教授是否受聘为学院院长",
])(
  "checks public appointments against official sources instead of treating unrelated articles as sufficient: %s",
  (query) => {
    const policy = externalPolicy(query);
    expect(policy.intent).toBe("official");
    expect(policy.officialOnly).toBe(true);
    expect(policy.useXiaohongshu).toBe(false);
    expect(contentIntent(query).active).toBe(true);
    expect(
      supplementRequired(policy, [
        {
          hits: [
            {
              bodyAvailable: true,
              contentSnippet: "某研究院有国家社科基金重大项目首席专家8名。",
            },
          ],
          activities: [],
        },
      ]),
    ).toBe(true);
  },
);

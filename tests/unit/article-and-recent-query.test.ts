import { describe, expect, it } from "vitest";
import {
  articleTitle,
  requiresPlaceLookup,
  wantsArticle,
} from "@/lib/server/assistant/intent";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import { inputGate } from "@/lib/server/assistant/input-gate";

describe("article lookup is not a place lookup", () => {
  it("extracts a quoted article title", () => {
    expect(
      articleTitle(
        '帮我找到"历练安保精兵 共筑平安校园——保卫部工会举办2026年体能大练兵暨趣味体能挑战赛-广东外语外贸大学工会委员会"这篇文章',
      ),
    ).toContain("历练安保精兵");
    expect(
      articleTitle("“学生社区文化传习实践：文化筑梦，强国有我”找到这篇文章"),
    ).toBe("学生社区文化传习实践：文化筑梦，强国有我");
    expect(
      articleTitle("帮我找到「光影无界·师生影像作品展」这篇文章"),
    ).toBe("光影无界·师生影像作品展");
  });
  it("never routes an article request to the map", () => {
    const message = "帮我找到《关于开展2026年校园文化活动的通知》这篇文章";
    expect(wantsArticle(message)).toBe(true);
    expect(requiresPlaceLookup(message)).toBe(false);
    expect(requiresPlaceLookup("带我去南苑11栋")).toBe(true);
  });
  it("keeps quoted titles inside the campus gate", () => {
    expect(inputGate('"学生社区文化传习实践：文化筑梦，强国有我"找到这篇文章')).toBe(
      "campus",
    );
  });
  it("routes article requests to knowledge with the title attached", () => {
    const intent = contentIntent(
      '帮我找到"历练安保精兵 共筑平安校园——保卫部工会举办2026年体能大练兵暨趣味体能挑战赛-广东外语外贸大学工会委员会"这篇文章',
    );
    expect(intent.articleLookup).toBe(true);
    expect(intent.map).toBe(false);
    expect(intent.tools).toEqual(["search_campus_knowledge"]);
    expect(intent.articleQuery).toContain("历练安保精兵");
  });
});

describe("recent radar queries keep the topic and drop filler words", () => {
  it("'竞赛活动情况' is still a competition recency request without a 情况 filter", () => {
    const intent = contentIntent("看看广外最近的竞赛活动情况");
    expect(intent.recentDiscovery).toBe(true);
    expect(intent.radarCategory).toBe("competition");
    expect(intent.retrievalQuery).toBe("广外 竞赛");
    expect(intent.tools).toContain("search_campus_events");
  });
  it("'最新的资讯' is a recency request even without a radar tag", () => {
    const intent = contentIntent("告诉我最新的资讯");
    expect(intent.recentDiscovery).toBe(true);
    expect(intent.radarCategory).toBeUndefined();
    expect(intent.tools).toContain("search_campus_events");
  });
});

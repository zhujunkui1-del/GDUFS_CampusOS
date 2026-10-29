import { describe, expect, it } from "vitest";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import { recentRadarAnswer } from "@/lib/server/assistant/evidence-answer";

function source(title: string, publishedAt: string | null): AssistantCard {
  return {
    kind: "source",
    title,
    publishedAt,
    sourceName: "广外",
    originalUrl: "https://example.com/a",
    snippet: "正文",
    authority: "official",
    evidenceType: "body",
  } as unknown as AssistantCard;
}

describe("recentRadarAnswer", () => {
  it("lists at most five newest distinct dated items", () => {
    const answer = recentRadarAnswer(
      [
        source("旧活动", "2026-10-01"),
        source("最新活动", "2026-10-29"),
        source("重复活动", "2026-10-28"),
        source("重复活动", "2026-10-28"),
        source("竞赛-分类页", "2026-10-30"),
        source("次新活动", "2026-10-27"),
        source("第三活动", "2026-10-26"),
        source("第四活动", "2026-10-25"),
        source("无日期", null),
      ],
      "文体活动",
    );
    expect(answer?.split("\n").filter((line) => /^\d+\. /.test(line))).toEqual([
      "1. 2026-10-29 发布｜最新活动",
      "2. 2026-10-28 发布｜重复活动",
      "3. 2026-10-27 发布｜次新活动",
      "4. 2026-10-26 发布｜第三活动",
      "5. 2026-10-25 发布｜第四活动",
    ]);
  });

  it("returns undefined when fewer than three dated items exist", () => {
    expect(
      recentRadarAnswer([
        source("一", "2026-10-29"),
        source("二", "2026-10-28"),
      ]),
    ).toBeUndefined();
  });
});

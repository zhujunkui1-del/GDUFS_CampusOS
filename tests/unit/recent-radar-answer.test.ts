import { describe, expect, it } from "vitest";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import {
  activitySignature,
  recentRadarAnswer,
} from "@/lib/server/assistant/evidence-answer";

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

  it("collapses different articles about the same activity", () => {
    expect(
      activitySignature(
        "广外的专属Livehouse！第29届秋之声校园歌手大赛，开唱！",
      ),
    ).toBe(
      activitySignature(
        "最佳人气奖评选 _ 数统学院 “笙歌赴韵” 秋之声歌唱比赛",
      ),
    );
    const answer = recentRadarAnswer([
      source("广外的专属Livehouse！第29届秋之声校园歌手大赛，开唱！", "2026-10-28"),
      source("最佳人气奖评选 _ 数统学院 “笙歌赴韵” 秋之声歌唱比赛", "2026-10-27"),
      source("法学院党史知识竞赛初赛预告", "2026-10-28"),
      source("国际部英语演讲比赛圆满收官", "2026-10-28"),
      source("校运会报名通知", "2026-10-26"),
    ]);
    expect(answer).not.toContain("笙歌赴韵");
    expect(answer?.match(/秋之声/g)).toHaveLength(1);

    const sameEvent = recentRadarAnswer([
      source("专属Livehouse！广外校园歌手大赛开唱！", "2026-10-28"),
      source(
        "广外的专属Livehouse！第29届秋之声校园歌手大赛，开唱！",
        "2026-10-28",
      ),
      source("法学院党史知识竞赛初赛预告", "2026-10-28"),
      source("国际部英语演讲比赛圆满收官", "2026-10-28"),
      source("校运会报名通知", "2026-10-26"),
    ]);
    expect(sameEvent).not.toContain("第29届");
    expect(sameEvent?.match(/Livehouse/gi)).toHaveLength(1);
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

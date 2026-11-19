import { buildQueryPlan, queryRelevance } from "@/lib/retrieval/query-plan";
import { describe, expect, it } from "vitest";
import { requestTimeWindow } from "@/lib/server/assistant/time-window";

describe("recent notice time window", () => {
  it("does not turn recent event discovery into an event-date filter", () => {
    expect(
      requestTimeWindow("最近有什么讲座吗", Date.parse("2026-10-29T04:00:00Z")),
    ).toBeUndefined();
    expect(
      requestTimeWindow("最近有什么竞赛吗", Date.parse("2026-10-29T04:00:00Z")),
    ).toBeUndefined();
  });

  it("treats 最近的校园通知 as a 30-day publication window", () => {
    const w = requestTimeWindow(
      "最近的校园通知",
      Date.parse("2026-10-29T04:00:00Z"),
    );
    expect(w).toMatchObject({
      after: "2026-09-30",
      before: "2026-10-29",
      role: "publication",
    });
  });
});

it("recalls official campus-card loss handling and study-abroad guidance from natural wording", () => {
  const card = buildQueryPlan("校园卡丢了怎么办？");
  expect(
    queryRelevance(card, {
      title: "校园卡管理办法",
      contentSnippet: "实体卡不慎丢失，可通过公众号挂失，持有效证件补办。",
    }).relevant,
  ).toBe(true);
  const exchange = buildQueryPlan("广外出国交换项目怎么申请？");
  expect(
    queryRelevance(exchange, {
      title: "本科生国（境）外访学交流项目常见问题",
      contentSnippet: "交换生项目，学生根据具体项目通知向学院递交申请材料。",
    }).relevant,
  ).toBe(true);
});

import { describe, expect, it } from "vitest";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import {
  dateRangeIn,
  requestTimeWindow,
  stripTimeRange,
} from "@/lib/server/assistant/time-window";
import { buildQueryPlan } from "@/lib/retrieval/query-plan";

// 2026-11-09 is a Monday. "最近两周" is a rolling window, not a calendar week.
const now = new Date("2026-11-09T20:00:00+08:00").getTime();

describe("a written date range is a constraint, not a keyword", () => {
  it("reads 11月10号到11月22号 as a range", () => {
    expect(dateRangeIn("11月10号到11月22号可以参加的活动", "2026-11-09")).toEqual({
      after: "2026-11-10",
      before: "2026-11-22",
    });
  });

  it("reads both sides of a cross-month range", () => {
    expect(dateRangeIn("11月28日到12月5日有什么活动", "2026-11-09")).toEqual({
      after: "2026-11-28",
      before: "2026-12-05",
    });
  });

  it("keeps an explicit year when the source states one", () => {
    expect(dateRangeIn("2027年11月10日到11月22日", "2026-11-09")).toEqual({
      after: "2027-11-10",
      before: "2027-11-22",
    });
  });

  it("treats a range that already ended this year as next year", () => {
    expect(dateRangeIn("1月5号到1月10号", "2026-11-09")).toEqual({
      after: "2027-01-05",
      before: "2027-01-10",
    });
  });

  it("rejects a reversed range", () => {
    expect(dateRangeIn("11月22号到11月10号", "2026-11-09")).toBeNull();
  });

  it("strips the range before lexical retrieval", () => {
    expect(stripTimeRange("11月10号到11月22号可以参加的活动")).toBe(
      "可以参加的活动",
    );
    expect(stripTimeRange("有什么最近两周可以去参加的活动吗")).toBe(
      "有什么 可以去参加的活动吗",
    );
  });
});

describe("recent two weeks is attendable, not published", () => {
  it("opens an upcoming window for attendance", () => {
    expect(requestTimeWindow("有什么最近两周可以去参加的活动吗", now)).toEqual({
      after: "2026-11-09",
      before: "2026-11-23",
      role: "event",
      timezone: "Asia/Shanghai",
    });
  });

  it("keeps a publication window for news", () => {
    expect(requestTimeWindow("最近两周的校园新闻", now)?.role).toBe(
      "publication",
    );
  });

  it("uses the explicit range instead of the word 最近", () => {
    expect(requestTimeWindow("11月10号到11月22号可以参加的活动", now)).toEqual({
      after: "2026-11-10",
      before: "2026-11-22",
      role: "event",
      timezone: "Asia/Shanghai",
    });
  });
});

describe("a time-boxed browse does not require the phrase to appear in an article", () => {
  it("routes to the event index and drops the empty subject", () => {
    const intent = contentIntent("有什么最近两周可以去参加的活动吗", [], now);
    expect(intent.tools).toEqual(["search_campus_events"]);
    expect(intent.retrievalQuery).toBe("活动");
    expect(intent.timeWindow?.after).toBe("2026-11-09");
  });

  it("keeps an explicit date range out of the query words", () => {
    const intent = contentIntent("11月10号到11月22号可以参加的活动", [], now);
    expect(intent.tools).toEqual(["search_campus_events"]);
    expect(intent.retrievalQuery).toBe("活动");
    expect(intent.timeWindow?.after).toBe("2026-11-10");
  });

  it("keeps a named category when the user names one", () => {
    const intent = contentIntent("本周有哪些讲座", [], now);
    expect(intent.retrievalQuery).toBe("讲座");
    expect(intent.radarCategory).toBe("lecture");
  });

  it("does not leave a date fragment as a hard subject filter", () => {
    for (const query of [
      "11月10号到11月22号可以参加的活动",
      "有什么最近两周可以去参加的活动吗",
      "最近两周的活动",
    ]) {
      const plan = buildQueryPlan(query);
      expect(
        plan.modifiers.map((m) => m.original),
        query,
      ).toEqual([]);
      expect(plan.temporalExpression, query).not.toBeNull();
    }
  });
});

const history = [
  { id: "u1", role: "user" as const, text: "有什么最近两周可以去参加的活动吗", cards: [] },
  { id: "a1", role: "assistant" as const, text: "1. 金融学院……", cards: [] },
];

describe("a follow-up keeps the time box of the list it continues", () => {
  it("pages the same list instead of searching a new phrase", () => {
    const intent = contentIntent("还有吗", history, now);
    expect(intent.discoveryFollowup).toBe(true);
    expect(intent.retrievalQuery).toBe("活动");
    expect(intent.timeWindow).toMatchObject({
      after: "2026-11-09",
      before: "2026-11-23",
      role: "event",
    });
  });

  it("switches the category but keeps the window", () => {
    const intent = contentIntent("换成讲座呢", history, now);
    expect(intent.radarCategory).toBe("lecture");
    expect(intent.retrievalQuery).toBe("讲座");
    expect(intent.timeWindow?.after).toBe("2026-11-09");
    expect(intent.tools).toEqual(["search_campus_events"]);
  });

  it("treats a bare switch as a plain topic when there is no history", () => {
    const intent = contentIntent("换成讲座呢", [], now);
    expect(intent.retrievalQuery).toBe("讲座");
    expect(intent.timeWindow).toBeUndefined();
  });

  it("keeps a time-boxed browse out of the recency-publication lane", () => {
    const intent = contentIntent("最近两周有哪些讲座", [], now);
    expect(intent.recentDiscovery).toBe(false);
    expect(intent.timeWindow?.role).toBe("event");
  });
});

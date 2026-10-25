import { describe, it, expect } from "vitest";
import { classifyArticleContent } from "@/lib/ingestion/article-intent";
import {
  extractArticleStructure,
  activityStatus,
} from "@/lib/ingestion/article-times";
import { ArticleAnalysisSchema } from "@/domain/console/article-analysis";
import { articleText, evidenceValid } from "@/lib/ingestion/article-text";
function run(
  body: string,
  publishedAt: string | null = "2026-10-01",
  title = "校园讲座报名通知",
) {
  const input = { title, body, publishedAt };
  const result = ArticleAnalysisSchema.parse(
    extractArticleStructure(input, classifyArticleContent(input)),
  );
  const t = articleText(input);
  for (const a of result.activities) {
    for (const e of a.evidence) expect(evidenceValid(t, e)).toBe(true);
    for (const w of a.registrationWindows)
      for (const p of [w.start, w.end])
        if (p) expect(evidenceValid(t, p.evidence)).toBe(true);
  }
  return result;
}
const window = (body: string, pub?: string | null) =>
  run(body, pub).activities[0].registrationWindows[0];
describe("evidence bound registration times", () => {
  it("only deadline has no made up start or end of day", () => {
    const w = window("请于10月20日前报名。");
    expect(w.start).toBeNull();
    expect(w.end?.date).toBe("2026-10-20");
    expect(w.end?.at).toBeNull();
    expect(w.end?.inferred).toBe(true);
    expect(w.deadlineSemantics).toBe("before");
  });
  it("only start", () => {
    const w = window("报名开始时间：2026年10月8日。");
    expect(w.start?.date).toBe("2026-10-08");
    expect(w.end).toBeNull();
  });
  it("interval with abbreviated end", () => {
    const w = window("报名时间：10月8日至15日。");
    expect(w.start?.date).toBe("2026-10-08");
    expect(w.end?.date).toBe("2026-10-15");
  });
  it("relative start uses publication with inference", () => {
    const w = window("报名时间：即日起至10月30日。");
    expect(w.start?.raw).toBe("即日起");
    expect(w.start?.inferred).toBe(true);
    expect(w.start?.date).toBe("2026-10-01");
  });
  it("relative start without publication stays unknown", () => {
    const w = window("报名时间：即日起至10月30日。", null);
    expect(w.start).toBeNull();
    expect(w.end?.date).toBeNull();
  });
  it("capacity does not invent deadline", () => {
    const a = run("即日起报名，额满即止。");
    expect(a.hasRegistration).toBe(true);
    expect(a.activities[0].registrationWindows[0].end).toBeNull();
  });
  it("no registration", () => {
    const a = run("讲座时间：2026年11月5日。无需预约，直接到场。");
    expect(a.registrationStatus).toBe("not_required");
    expect(a.hasRegistration).toBe(false);
  });
  it("event and registration are separate", () => {
    const a = run("讲座时间：11月5日；报名截止：11月3日17:00。").activities[0];
    expect(a.startsAt?.date).toBe("2026-11-05");
    expect(a.registrationWindows[0].end?.at).toBe("2026-11-03T17:00:00+08:00");
  });
  it("work deadline is separate", () => {
    const a = run("报名截止10月20日，作品提交截止11月5日。").activities[0];
    expect(a.registrationWindows[0].end?.date).toBe("2026-10-20");
    expect(a.otherDeadlines[0].role).toBe("work_submission");
    expect(a.otherDeadlines[0].time.date).toBe("2026-11-05");
  });
  it("two batches", () => {
    const a = run("报名时间：第一批截止9月30日，第二批截止10月15日。")
      .activities[0];
    expect(a.registrationWindows.map((w) => w.roundLabel)).toEqual([
      "第一批",
      "第二批",
    ]);
    expect(a.registrationWindows.map((w) => w.end?.date)).toEqual([
      "2026-09-30",
      "2026-10-15",
    ]);
  });
  it("multiple activities do not reuse a document ID", () => {
    const r = run(
      "活动名称：甲讲座\n讲座时间：11月5日\n报名截止：11月3日\n活动名称：乙比赛\n比赛时间：11月8日\n报名截止：11月6日",
    );
    expect(r.activities).toHaveLength(2);
    expect(r.activities[0].key).not.toBe(r.activities[1].key);
    expect(r.activities[1].registrationWindows[0].end?.date).toBe("2026-11-06");
  });
  it("cross year", () => {
    const w = window("报名时间：2026年12月30日至1月5日。");
    expect(w.end?.date).toBe("2027-01-05");
  });
  it("no trusted year means unknown", () => {
    expect(window("报名截止：10月20日。", null).end?.date).toBeNull();
  });
  it("heading separated from a precise evening time", () => {
    const w = window("报名截止时间\n2026年10月25日晚20:00前");
    expect(w.end?.at).toBe("2026-10-25T20:00:00+08:00");
    expect(w.end?.resolution).toBe("minute");
    expect(w.end?.inferred).toBe(false);
  });
  it("attachment or image only does not make up dates", () => {
    for (const body of ["报名时间详见附件。", "请扫码报名，时间见海报图片。"]) {
      const a = run(body);
      expect(a.hasRegistration).toBe(true);
      expect(a.activities[0].registrationWindows[0].end).toBeNull();
    }
  });
  it("notice without registration never gets badge", () => {
    const a = run(
      "停水时间：2026年10月20日，恢复供水后另行通知。",
      undefined,
      "临时停水通知",
    );
    expect(a.hasRegistration).toBe(false);
  });
  it("past deadline keeps badge and read time derives closed", () => {
    const a = run("报名截止2026年10月20日。");
    expect(a.hasRegistration).toBe(true);
    expect(activityStatus(a.activities[0], "2026-11-01T00:00:00+08:00")).toBe(
      "registration_closed",
    );
  });
  it("invalid dates stay unknown", () => {
    expect(window("报名截止2026年2月30日。").end?.date).toBeNull();
  });
});

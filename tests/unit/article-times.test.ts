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

describe("registration badge needs an offer the reader can act on", () => {
  it("recognises a recruitment post that never says 报名", () => {
    const a = run(
      "报名方式：请将简历发送至 hr@example.com，邮件主题注明应聘岗位。",
      "2026-10-01",
      "【2027校招】某集团校园招聘正式启动",
    );
    expect(a.hasRegistration).toBe(true);
  });
  it("drops a sales advert that only repeats 报名方式", () => {
    const a = run(
      "报名方式：报名体检接送一站式服务，名额有限，先到先得。",
      "2026-10-01",
      "广外表白墙|穿白衣服的女生，已经在驾校偶遇你好几次了",
    );
    expect(a.hasRegistration).toBe(false);
  });
  it("drops a result list that reports who already applied", () => {
    const a = run(
      "报名名单公示如下，录取名单见附件。",
      "2026-10-01",
      "关于赴香港浸会大学交换生报名名单公示",
    );
    expect(a.hasRegistration).toBe(false);
  });
  it("keeps a selection notice whose title invites applications", () => {
    const a = run(
      "报名前请确认自己是否符合条件，录取名单后续公布。",
      "2026-10-01",
      "关于赴爱尔兰都柏林圣三一大学交流生项目选拔的通知",
    );
    expect(a.hasRegistration).toBe(true);
  });
  it("recognises an exam notice that says 报考 but never 报名", () => {
    const a = run(
      "三、报考时间：2026年9月14-16日，下午4:00后截止报考及缴费。四、报考方式：考生网上报考。",
      "2026-09-01",
      "关于2026年10月公开学院实践考核课程补考考试的报考通知",
    );
    expect(a.hasRegistration).toBe(true);
  });
  it("does not badge a tuition payment notice that only says 缴费", () => {
    const a = run(
      "学生应在规定时间内通过学校缴费平台缴纳学费，缴费方式见附件。",
      "2026-09-01",
      "广东外语外贸大学本科生缴费办法",
    );
    expect(a.hasRegistration).toBe(false);
  });
  it("does not badge a warning that quotes other people's process", () => {
    const a = run(
      "警惕以招聘为名收取费用，咨询电话 12333。",
      "2026-10-01",
      "【就业资讯】注意防骗！五部门发布重要风险提示",
    );
    expect(a.hasRegistration).toBe(false);
  });
});

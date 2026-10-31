import { it, expect } from "vitest";
import { analyzeArticle } from "@/lib/ingestion/article-analysis";
import {
  calendarInput,
  calendarizeArticle,
} from "@/lib/ingestion/calendar-extraction";
const get = (title: string, body: string) =>
  analyzeArticle({ title, body, publishedAt: "2026-10-30" });
const accepted = (title: string, body: string) =>
  get(title, body).activities.filter((a) => a.calendar?.eligible);
it.each([
  [
    "2026年讲座预告",
    "本次讲座将于11月5日下午两点半在大学城校区学生活动中心二楼举行。",
    "2026-11-05",
    "2026-11-05T14:30:00+08:00",
  ],
  ["2026年讲座通知", "讲座时间：11月5日。", "2026-11-05", null],
  ["论坛预告", "论坛时间：2026年12月31日至2027年1月2日。", "2026-12-31", null],
])(
  "extracts actual dates without midnight or place invention: %s",
  (title, body, date, at) => {
    const a = accepted(title, body)[0];
    expect(a?.startsAt?.date).toBe(date);
    expect(a?.startsAt?.at).toBe(at);
    if (!body.includes("大学城")) expect(a?.placeRaw).toBeNull();
  },
);
it.each([
  ["讲座预告", "本次讲座近期举行。"],
  ["讲座预告", "发布时间：2026年10月30日。敬请期待。"],
  ["讲座报名通知", "报名截止：2026年11月3日17:00。"],
  ["喜报！比赛获奖", "获奖公示：2026年11月5日。"],
  ["学校工作新闻", "2026年11月5日，学校介绍工作进展。"],
  ["讲座预告", "讲座时间：11月5日14:30。"],
  ["2026年讲座通知", "讲座时间：2026年2月30日。"],
])("excludes unsupported calendar entries: %s", (title, body) =>
  expect(accepted(title, body)).toHaveLength(0),
);
it("selects earliest event candidate and ignores publication/registration", () => {
  const a = accepted(
    "2026年讲座预告",
    "发布日期：2026年10月30日。\n报名时间：2026年10月31日至11月2日。\n讲座时间：11月7日。\n讲座时间：11月5日。",
  )[0];
  expect(a.startsAt?.date).toBe("2026-11-05");
  expect(a.calendar?.candidateDates).toEqual(["2026-11-05", "2026-11-07"]);
});
it.each([
  ["2026年论坛通知", "论坛时间：11月5日至7日。", "2026-11-05", "2026-11-07"],
  [
    "2026年论坛通知",
    "论坛时间：11月30日至12月2日。",
    "2026-11-30",
    "2026-12-02",
  ],
  [
    "论坛通知",
    "论坛时间：2026年12月31日至2027年1月2日。",
    "2026-12-31",
    "2027-01-02",
  ],
  ["2028年论坛通知", "论坛时间：2月28日至3月1日。", "2028-02-28", "2028-03-01"],
])("keeps continuous intervals inclusive: %s %s", (title, body, start, end) => {
  const a = accepted(title, body)[0];
  expect(a.startsAt?.date).toBe(start);
  expect(a.endsAt?.date).toBe(end);
});
it("splits independent activities instead of choosing one earliest date for the entire article", () => {
  const a = accepted(
    "2026年活动汇总",
    "活动名称：人工智能讲座\n讲座时间：2026年11月5日14:00\n活动名称：读书会活动\n活动时间：2026年11月7日19:00",
  );
  expect(a).toHaveLength(2);
  expect(a.map((x) => x.startsAt?.date)).toEqual(["2026-11-05", "2026-11-07"]);
});
it("allows a precisely dated historical event, without using report publication", () => {
  const a = accepted(
    "2026年讲座回顾",
    "2026年9月10日，学术讲座在大学城报告厅举行了。",
  )[0];
  expect(a.startsAt?.date).toBe("2026-09-10");
  expect(a.calendar?.nature).toBe("recap");
});
it("rejects conflicting body/poster dates", () => {
  const input = calendarInput({
    title: "2026年讲座预告",
    body: "讲座时间：2026年11月5日。",
    calendarSources: [
      {
        id: "poster-1",
        kind: "image",
        url: "https://example.invalid/poster.png",
        locator: "img[1]",
        digest: "fixture",
        method: "isolated-ocr-text",
        text: "讲座时间：2026年11月7日。",
      },
    ],
  });
  const a = calendarizeArticle(input, analyzeArticle(input));
  expect(a.activities.some((x) => x.calendar?.eligible)).toBe(false);
});
it("extracts separate real HTML table rows with a known year", () => {
  const a = analyzeArticle({
    title: "2026年讲座安排",
    bodyFormat: "reading_html",
    body: "<table><tr><th>活动名称</th><th>举办时间</th><th>地点</th></tr><tr><td>人工智能讲座</td><td>11月5日14:00</td><td>大学城报告厅</td></tr><tr><td>经济学讲座</td><td>11月6日</td><td></td></tr></table>",
  });
  expect(a.activities.filter((x) => x.calendar?.eligible)).toHaveLength(2);
});
it("reads a clock range inside a weekday parenthesis without inserting midnight", () => {
  const a = accepted(
    "2026年讲座预告",
    "报告时间：2026年11月3日（周二13:00–16:00）",
  )[0];
  expect(a.startsAt?.at).toBe("2026-11-03T13:00:00+08:00");
  expect(a.endsAt?.at).toBe("2026-11-03T16:00:00+08:00");
});
it("does not turn an opening ceremony time range into the entire competition schedule", () => {
  const a = accepted(
    "信息科学与技术学院2026院运会报名通知",
    "比赛时间：2026年11月7日\n比赛地点：假草场\n开幕式\n时间：2026 11.7 7:30-9:20\n其他比赛项目安排另见通知。",
  );
  expect(a).toHaveLength(2);
  expect(a[0].startsAt?.at).toBeNull();
  expect(a[0].endsAt).toBeNull();
  expect(a[1].title).toContain("开幕式");
  expect(a[1].startsAt?.at).toBe("2026-11-07T07:30:00+08:00");
  expect(a[1].endsAt?.at).toBe("2026-11-07T09:20:00+08:00");
});
it("splits explicit numbered sessions written as prose", () => {
  const a = accepted(
    "2026年本周讲座汇总",
    "第一场：讲座将于11月5日14:00举行。\n第二场：讲座将于11月7日19:00举行。",
  );
  expect(a).toHaveLength(2);
  expect(a.map((x) => x.startsAt?.date)).toEqual(["2026-11-05", "2026-11-07"]);
});
it("treats an explicitly undecided venue as absent instead of showing placeholder copy", () => {
  const a = accepted(
    "2026年讲座预告",
    "讲座时间：2026年11月5日。地点：待定，另行通知。",
  )[0];
  expect(a.placeRaw).toBeNull();
});
it("invalidates captions from the superseded OCR prompt rather than retaining fabricated organiser fields", () => {
  const input = {
    title: "2026年招聘会",
    body: "详情见海报",
    calendarSources: [
      {
        id: "old",
        kind: "image" as const,
        url: "https://lib.gdufs.edu.cn/p.png",
        locator: "img[1]",
        digest: "old",
        method: "@cf/google/gemma-4-26b-a4b-it-ocr",
        text: "举办时间：2026年11月10日；主办单位：仅是署名",
      },
    ],
  };
  const before = analyzeArticle({
    ...input,
    calendarSources: input.calendarSources.map((s) => ({
      ...s,
      method: "isolated-fixture",
    })),
  });
  const filtered = calendarInput(input);
  const after = calendarizeArticle(filtered, before);
  expect(filtered.calendarSources).toEqual([]);
  expect(after.activities.some((a) => a.calendar?.eligible)).toBe(false);
});
it("does not attach a later overall activity period to the last tentative competition phase", () => {
  const a = accepted(
    "2026-2027数学与统计学院红色演艺大赛",
    "活动安排\n初赛\n11.12 周四（暂定）\n决赛\n11.29 周日下午（暂定）\n04.活动赛制\n本活动分为初赛和决赛两个部分。\n02\n活动时间\n2026年10月15日-2026年11月29日\n03\n报名方式\n请于10月25日前报名。",
  );
  expect(a).toHaveLength(1);
  expect(a[0].title).not.toContain("· 决赛");
  expect(a[0].startsAt?.date).toBe("2026-10-15");
  expect(a[0].endsAt?.date).toBe("2026-11-29");
});
it("splits a converted attachment table into individually evidenced activities", () => {
  const input = {
    title: "2026年讲座安排",
    body: "见附件",
    calendarSources: [
      {
        id: "pdf",
        kind: "attachment" as const,
        url: "https://lib.gdufs.edu.cn/events.pdf",
        locator: "a[1]",
        digest: "isolated",
        method: "workers-ai-toMarkdown",
        text: "# 讲座安排\n\n| 活动名称 | 举办时间 | 地点 |\n| --- | --- | --- |\n| 人工智能讲座 | 2026年11月5日14:30 | 大学城报告厅 |\n| 经济学讲座 | 2026年11月7日 | |",
      },
    ],
  };
  const a = analyzeArticle(input).activities.filter(
    (a) => a.calendar?.eligible,
  );
  expect(a.map((a) => a.startsAt?.date)).toEqual(["2026-11-05", "2026-11-07"]);
  expect(a[1].placeRaw).toBeNull();
});

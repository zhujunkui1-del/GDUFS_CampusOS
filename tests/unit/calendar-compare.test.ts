import { expect, it } from "vitest";
import { dateGateFixture } from "../fixtures/date-gate";
import { analysisStatements } from "@/lib/server/console/article-analysis";
import {
  resolveCalendarIntent,
  runCalendarComparison,
  calendarPair,
  compareCalendarPair,
  describeCalendarDate,
  calendarComparisonStatus,
  renderCalendarComparison,
} from "@/lib/server/calendar/compare";
import { PersonalTaskStore } from "@/lib/server/account/tasks";
import { personalRead } from "@/lib/server/assistant/personal-reads";

it("compares the two named sources rather than to-do deadlines, and recovers an attached end clock from the source", async () => {
  const f = await dateGateFixture();
  try {
    const examples = [
      [
        "eval-speech",
        "2026年新生语音语调大赛",
        "活动时间：11.19 13:50-15:10。",
      ],
      [
        "eval-finance",
        "金融学院第六届金融热点分析大赛参赛指南 · 决赛",
        "活动时间：2026年11月19日19:00至21:00。",
      ],
      ["eval-unknown", "校园写作比赛初赛", "活动时间：2026年11月19日13:00。"],
      [
        "eval-overlap",
        "英语朗读会决赛项目",
        "活动时间：2026年11月19日14:00至16:00。",
      ],
      [
        "eval-speech-other",
        "2026年新生语音语调大赛",
        "活动时间：2026年11月18日14:00至16:00。",
      ],
    ];
    for (const [id, title, body] of examples) {
      await f.article(id, "2026-11-15", title, `<p>${body}</p>`);
      const d = await f.store.document(id);
      await f.db.batch(
        await analysisStatements(f.db, id, d.contentRevision, d.inputHash!, {
          title,
          body,
          publishedAt: "2026-11-15",
        }),
      );
    }
    f.sqlite
      .prepare(
        "UPDATE article_activity_index SET ends_day=NULL,ends_at=NULL,activity_json=json_set(activity_json,'$.endsAt',NULL) WHERE document_id='eval-speech'",
      )
      .run();
    const question = `${examples[0][1]}和${examples[1][1]} 这两场活动的时间冲突吗`;
    const names = calendarPair(question);
    expect(names).toEqual([examples[0][1], examples[1][1]]);
    const open = await compareCalendarPair(f.db, names!);
    expect(open).toContain("时间不冲突");
    expect(open).toContain("在同一天的场次");
    expect(open).toContain("13:50 至 15:10");
    expect(open).toContain("19:00 至 21:00");
    const overnight = await runCalendarComparison(f.db, {
      pair: [examples[0][1], examples[1][1]],
      dates: ["2026-11-19", "2026-11-19"],
    });
    overnight.matches[0][0].activity.startsAt!.at = "2026-11-19T23:30:00+08:00";
    overnight.matches[1][0].activity.startsAt!.at = "2026-11-19T16:30:00Z";
    overnight.ends = ["2026-11-20T01:00:00+08:00", "2026-11-20T02:00:00+08:00"];
    expect(renderCalendarComparison(overnight)).toContain("重叠 30 分钟");
    const missingOne = await runCalendarComparison(f.db, {
      pair: [examples[1][1], "校外艺术表演未刊通知"],
      dates: ["2026-11-19", "2026-11-19"],
    });
    expect(calendarComparisonStatus(missingOne)).toEqual({
      retrievalStatus: "partial",
      taskStatus: "insufficient_evidence",
    });
    expect(missingOne.text).not.toContain(examples[3][1]);
    const missingBoth = await runCalendarComparison(f.db, {
      pair: ["校外艺术表演未刊通知", "暑期实践毫无匹配"],
      dates: [null, null],
    });
    expect(calendarComparisonStatus(missingBoth)).toEqual({
      retrievalStatus: "empty",
      taskStatus: "insufficient_evidence",
    });
    const now = Date.parse("2026-11-17T10:00:00+08:00");
    const pending = (
      await runCalendarComparison(f.db, {
        pair: [examples[0][1], "另一个日期的比赛"],
        dates: [null, null],
      })
    ).state;
    const selection = `${examples[0][1]} 的11月19号的场次`;
    expect(
      await resolveCalendarIntent(f.db, selection, undefined, now),
    ).toEqual({
      title: examples[0][1],
      date: "2026-11-19",
    });
    expect(await resolveCalendarIntent(f.db, selection, pending, now)).toEqual({
      pair: pending.pair,
      dates: ["2026-11-19", null],
    });
    const described = await describeCalendarDate(
      f.db,
      examples[0][1],
      "2026-11-19",
    );
    expect(described).toContain("13:50 至 15:10");
    expect(described).not.toContain("2026-11-18");
    expect(
      await compareCalendarPair(f.db, [examples[2][1], examples[1][1]]),
    ).toContain("暂不能确定是否冲突");
    expect(
      await compareCalendarPair(f.db, [examples[0][1], examples[3][1]]),
    ).toContain("尚未结束，时间冲突");

    const user = "compare-fixture";
    f.sqlite
      .prepare("INSERT INTO users(id,display_name) VALUES(?,?)")
      .run(user, user);
    const tasks = new PersonalTaskStore(f.db);
    for (const [id, title] of examples.slice(0, 3)) {
      await tasks.create(user, {
        key: crypto.randomUUID(),
        title: `参加：${title}`,
        dueAt: "2026-11-16T10:00:00+08:00",
        notes: "",
        source: { articleId: id },
      });
    }
    const personal = await personalRead(
      f.db,
      user,
      `我的代办事项中 ${question}`,
    );
    expect(personal?.text).toContain("时间不冲突");
    expect(personal?.text).toContain("13:50 至 15:10");
    expect(personal?.text).not.toContain(examples[2][1]);
    expect(
      (await personalRead(f.db, "not-the-owner", `我的代办事项中 ${question}`))
        ?.text,
    ).not.toContain("13:50");
  } finally {
    f.close();
  }
});

it("extracts published titles independently of punctuation, date wording and older comparisons", async () => {
  const f = await dateGateFixture();
  const volunteer = '#志愿者招募#校园同行——"守护天使"志愿活动2.0';
  const fair = "校园词典文化周｜电子词典展！";
  const now = Date.parse("2026-11-17T10:00:00+08:00");
  const previous = {
    pair: ["上一场讲座", "另一场竞赛"] as [string, string],
    dates: [null, "2026-11-22"] as [null, string],
    pending: [0],
  };
  try {
    for (const [id, title, time] of [
      ["eval-volunteer", volunteer, "14:00至16:00"],
      ["eval-fair", fair, "15:30至17:00"],
    ]) {
      const body = `活动时间：2026年11月20日${time}。`;
      await f.article(id, "2026-11-15", title, `<p>${body}</p>`);
      const d = await f.store.document(id);
      await f.db.batch(
        await analysisStatements(f.db, id, d.contentRevision, d.inputHash!, {
          title,
          body,
          publishedAt: "2026-11-15",
        }),
      );
    }
    for (const subject of [
      `${volunteer.replace("——", "--")} 和 ${fair.replace("｜", "|")}`,
      `“${volunteer.replace("——", "--")}” 和 “${fair}”`,
      `${volunteer}跟${fair}`,
    ]) {
      const plan = await resolveCalendarIntent(
        f.db,
        `11月20号当天的${subject}这两场活动的时间冲突吗`,
        previous,
        now,
      );
      expect(plan).toMatchObject({
        pair: [volunteer, fair],
        dates: ["2026-11-20", "2026-11-20"],
      });
      if (!plan || !("pair" in plan))
        throw new Error("comparison intent missing");
      const result = await runCalendarComparison(f.db, plan);
      expect(result.text).toContain("尚未结束，时间冲突");
      expect(result.subjects.map((subject) => subject.matches.length)).toEqual([
        1, 1,
      ]);
    }
    expect(
      await resolveCalendarIntent(f.db, "11月19号", previous, now),
    ).toMatchObject({
      pair: previous.pair,
      dates: ["2026-11-19", "2026-11-22"],
    });
  } finally {
    f.close();
  }
});

import { it, expect } from "vitest";
import { dateGateFixture, command } from "../fixtures/date-gate";
import { analysisStatements } from "@/lib/server/console/article-analysis";
import { readCalendar } from "@/lib/server/calendar/query";
import { intervalDays, weekOf } from "@/lib/retrieval/calendar-dates";
import { calendarIdentity } from "@/lib/ingestion/calendar-identity";
import { analyzeArticle } from "@/lib/ingestion/article-analysis";
import {
  calendarContentSearch,
  revalidateCalendarEvidence,
} from "@/lib/server/calendar/search";
import { EventSearchInputSchema } from "@/domain/retrieval/skills";
import { upcomingEvents } from "@/lib/server/assistant/upcoming-events";
it.each([
  ["2026-11-05", "2026-11-07", ["2026-11-05", "2026-11-06", "2026-11-07"]],
  ["2026-11-30", "2026-12-02", ["2026-11-30", "2026-12-01", "2026-12-02"]],
  ["2026-12-31", "2027-01-02", ["2026-12-31", "2027-01-01", "2027-01-02"]],
  ["2028-02-28", "2028-03-01", ["2028-02-28", "2028-02-29", "2028-03-01"]],
])(
  "expands inclusive dates without creating daily entities %s",
  (s, e, expected) => expect(intervalDays(s, e)).toEqual(expected),
);
it("starts weeks on Monday and preserves year boundaries", () =>
  expect(weekOf("2027-01-01")).toEqual([
    "2026-12-28",
    "2026-12-29",
    "2026-12-30",
    "2026-12-31",
    "2027-01-01",
    "2027-01-02",
    "2027-01-03",
  ]));
it("points an empty week at the next day that actually has an event", async () => {
  const f = await dateGateFixture();
  try {
    const d = await f.store.document("spring");
    await f.db.batch(
      await analysisStatements(f.db, d.id, d.contentRevision, d.inputHash!, {
        title: "2026年学术论坛通知",
        body: "论坛时间：2026年12月20日至21日。",
        publishedAt: "2026-12-01",
      }),
    );
    const empty = await readCalendar(f.db, {
      after: "2026-11-09",
      before: "2026-11-15",
      day: "2026-11-09",
    });
    expect(empty.items).toEqual([]);
    expect(empty.nextEventDay).toBe("2026-12-20");
    const busy = await readCalendar(f.db, {
      after: "2026-12-20",
      before: "2026-12-26",
      day: "2026-12-20",
    });
    expect(busy.nextEventDay).toBeNull();
  } finally {
    f.close();
  }
});
it("returns one interval on every day, exact counts, no manufactured clock, and no query writes", async () => {
  const f = await dateGateFixture();
  try {
    const d = await f.store.document("spring");
    await f.db.batch(
      await analysisStatements(f.db, d.id, d.contentRevision, d.inputHash!, {
        title: "2026年学术论坛通知",
        body: "论坛时间：2026年11月5日至7日。",
        publishedAt: "2026-10-01",
      }),
    );
    const r = await readCalendar(f.db, {
      after: "2026-11-06",
      before: "2026-11-08",
      day: "2026-11-06",
    });
    expect(r.items).toHaveLength(1);
    const evidence = await calendarContentSearch(
      f.db,
      EventSearchInputSchema.parse({
        query: "论坛",
        after: "2026-11-06",
        before: "2026-11-08",
        timeRole: "event",
      }),
      "2026-11-06T00:00:00Z",
    );
    expect(evidence.hits.length).toBeGreaterThan(0);
    expect(await revalidateCalendarEvidence(f.db, evidence.hits)).toBe(true);
    expect(r.dailyCounts).toEqual({
      "2026-11-06": 1,
      "2026-11-07": 1,
      "2026-11-08": 0,
    });
    expect(r.occurrences.map((o) => o.date)).toEqual([
      "2026-11-06",
      "2026-11-07",
    ]);
    expect(r.occurrences[0].startTime).toBeNull();
    expect(r.items[0].activity.placeRaw).toBeNull();
    expect(
      f.sqlite
        .prepare(
          "SELECT count(*) n FROM article_activity_index WHERE document_id=? AND calendar_eligible=1",
        )
        .get(d.id),
    ).toEqual({ n: 1 });
    expect(r.metrics.rowsWritten).toBe(0);
    await f.store.publish(
      d.id,
      { ...command(d.version), note: "下架日历测试" },
      true,
    );
    expect(
      (await readCalendar(f.db, { after: "2026-11-06", before: "2026-11-08" }))
        .items,
    ).toEqual([]);
    expect(await revalidateCalendarEvidence(f.db, evidence.hits)).toBe(false);
  } finally {
    f.close();
  }
});
it("deduplicates matching organisers/venues but not different colleges or sessions", async () => {
  const base = analyzeArticle({
    title: "2026年秋之声活动预告",
    body: "活动时间：2026年11月5日19:00。\n地点：大学城活动中心。\n主办单位：校团委。",
  }).activities[0];
  const x = await calendarIdentity(base, "one");
  expect(await calendarIdentity(base, "two")).toBe(x);
  expect(
    await calendarIdentity({ ...base, organizer: "另一学院" }, "two"),
  ).not.toBe(x);
  expect(
    await calendarIdentity(
      {
        ...base,
        startsAt: { ...base.startsAt!, at: "2026-11-05T20:00:00+08:00" },
      },
      "two",
    ),
  ).not.toBe(x);
  expect(await calendarIdentity({ ...base, organizer: null }, "two")).not.toBe(
    await calendarIdentity({ ...base, organizer: null }, "one"),
  );
});
it("filters by campus and never maps a Baiyun or unknown place to University Town", async () => {
  const f = await dateGateFixture();
  try {
    const d = await f.store.document("spring");
    await f.db.batch(
      await analysisStatements(f.db, d.id, d.contentRevision, d.inputHash!, {
        title: "2026年讲座通知",
        body: "讲座时间：2026年11月5日14:30。地点：白云山校区图书馆。",
      }),
    );
    expect(
      (
        await readCalendar(f.db, {
          after: "2026-11-05",
          before: "2026-11-05",
          campus: "university_town",
        })
      ).items,
    ).toEqual([]);
    const r = await readCalendar(f.db, {
      after: "2026-11-05",
      before: "2026-11-05",
      campus: "baiyun",
    });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].mapPlace).toMatchObject({
      placeId: "osm-way-962936641",
      campus: "baiyun",
    });
  } finally {
    f.close();
  }
});
it("does not include stale content versions or date-only title metadata as an open registration claim", async () => {
  const f = await dateGateFixture();
  try {
    const d = await f.store.document("spring");
    await f.db.batch(
      await analysisStatements(f.db, d.id, d.contentRevision, d.inputHash!, {
        title: "2026年讲座报名通知",
        body: "讲座时间：2026年11月5日。报名截止：2026年11月3日。",
      }),
    );
    const query = { after: "2026-11-05", before: "2026-11-05" };
    expect(
      (
        await readCalendar(
          f.db,
          { ...query, registration: "open" },
          "2026-11-01T10:00:00+08:00",
        )
      ).items,
    ).toEqual([]);
    f.sqlite
      .prepare(
        "UPDATE document_article_analysis SET input_hash='stale' WHERE document_id=?",
      )
      .run(d.id);
    expect((await readCalendar(f.db, query)).items).toEqual([]);
  } finally {
    f.close();
  }
});
it("stable cursors page over canonical activities and reject a changed visibility revision", async () => {
  const f = await dateGateFixture();
  try {
    for (const [i, id] of ["spring", "autumn", "white"].entries()) {
      const d = await f.store.document(id);
      await f.db.batch(
        await analysisStatements(f.db, d.id, d.contentRevision, d.inputHash!, {
          title: `2026年讲座${i + 1}预告`,
          body: `讲座时间：2026年11月5日${14 + i}:00。`,
        }),
      );
    }
    const q = { after: "2026-11-05", before: "2026-11-05", limit: 1 };
    const a = await readCalendar(f.db, q);
    expect(a.total).toBe(3);
    expect(a.hasMore).toBe(true);
    const wholeDay = await readCalendar(f.db, {
      ...q,
      day: "2026-11-05",
      all: "1",
    });
    expect(wholeDay.items).toHaveLength(3);
    expect(wholeDay.hasMore).toBe(false);
    expect(wholeDay.nextCursor).toBeNull();
    const b = await readCalendar(f.db, { ...q, cursor: a.nextCursor! });
    expect(b.items[0].eventId).not.toBe(a.items[0].eventId);
    f.sqlite
      .prepare(
        "UPDATE console_engine_settings SET public_visibility_revision=public_visibility_revision+1",
      )
      .run();
    await expect(
      readCalendar(f.db, { ...q, cursor: b.nextCursor! }),
    ).rejects.toThrow("活动已更新");
  } finally {
    f.close();
  }
});

it("stores only the venue even when calendar extraction supplied a full sentence", async () => {
  const f = await dateGateFixture();
  try {
    const d = await f.store.document("spring");
    const input = {
      title: "2026年校园讲座通知",
      body: "讲座时间：2026年11月5日14:00。\n地点：大学城校区院系楼360会议室举办学术交流会。",
    };
    const fromSource = analyzeArticle(input);
    expect(fromSource.activities[0].placeRaw).toBe("大学城校区院系楼360会议室");
    fromSource.activities[0].placeRaw =
      "白云山校区第三教学楼318室顺利举行&#x20;";
    await f.db.batch(
      await analysisStatements(
        f.db,
        d.id,
        d.contentRevision,
        d.inputHash!,
        input,
        fromSource,
      ),
    );
    const row = f.sqlite
      .prepare(
        "SELECT place_raw,json_extract(activity_json,'$.placeRaw') AS place FROM article_activity_index WHERE document_id=?",
      )
      .get(d.id);
    expect(row).toMatchObject({
      place: "白云山校区第三教学楼318室",
      place_raw: "白云山校区第三教学楼318室",
    });
    const analysis = f.sqlite
      .prepare(
        "SELECT json_extract(analysis_json,'$.activities[0].placeRaw') AS place FROM document_article_analysis WHERE document_id=?",
      )
      .get(d.id);
    expect(analysis?.place).toBe("白云山校区第三教学楼318室");
  } finally {
    f.close();
  }
});

it("shows a notice without hours once per day, and keeps stated sessions apart", async () => {
  const f = await dateGateFixture();
  try {
    const [a, b] = [
      await f.store.document("spring"),
      await f.store.document("autumn"),
    ];
    await f.db.batch(
      await analysisStatements(f.db, a.id, a.contentRevision, a.inputHash!, {
        title: "2026年运动会安排",
        body: "详见附件。",
        publishedAt: "2026-10-20",
        calendarSources: [
          {
            id: "t1",
            kind: "table" as const,
            url: "https://www.gdufs.edu.cn/info/1.htm",
            locator: "table[1]",
            digest: "isolated",
            method: "html-table",
            text: "日期 | 地点 | 项目名称\n2026年11月5日 | 田径场 | 男子百米\n2026年11月5日 | 体育馆 | 女子篮球\n2026年11月6日 | 田径场 | 决赛",
          },
        ],
      }),
    );
    await f.db.batch(
      await analysisStatements(f.db, b.id, b.contentRevision, b.inputHash!, {
        title: "2026年宣讲会",
        body: "详见附件。",
        publishedAt: "2026-10-20",
        calendarSources: [
          {
            id: "t1",
            kind: "table" as const,
            url: "https://www.gdufs.edu.cn/info/2.htm",
            locator: "table[1]",
            digest: "isolated",
            method: "html-table",
            text: "序号 | 日期 | 开始时间 | 单位名称 | 地点 | 形式\n1 | 2026年11月5日 | 15:30 | 甲公司 | 一教109 | 宣讲\n2 | 2026年11月5日 | 19:00 | 乙公司 | 一教109 | 宣讲",
          },
        ],
      }),
    );
    const r = await readCalendar(f.db, {
      after: "2026-11-05",
      before: "2026-11-06",
      day: "2026-11-05",
    });
    expect(
      r.items
        .map((i) => i.activity.startsAt?.at)
        .filter(Boolean)
        .sort(),
    ).toEqual(["2026-11-05T15:30:00+08:00", "2026-11-05T19:00:00+08:00"]);
    // The two-hourless table is one card for the day, so the day holds three.
    expect(r.dailyCounts["2026-11-05"]).toBe(3);
  } finally {
    f.close();
  }
});

it("uses the published calendar index identity in assistant links instead of recomputing it", async () => {
  const { searchContent } = await import("@/lib/server/retrieval/skills");
  const f = await dateGateFixture();
  try {
    const title = "校园电机企业宣讲会";
    const body =
      "宣讲时间：2026年11月16日14:30至16:00。地点：白云山校区一教南404。";
    await f.article("link-event", "2026-11-15", title, body);
    const d = await f.store.document("link-event");
    await f.db.batch(
      await analysisStatements(
        f.db,
        d.id,
        d.contentRevision,
        d.inputHash!,
        { title, body, publishedAt: "2026-11-15" },
        undefined,
        "licensed_full_text",
      ),
    );
    const currentId = "event-" + "c".repeat(40);
    f.sqlite
      .prepare(
        "UPDATE article_activity_index SET group_key=? WHERE document_id=?",
      )
      .run(currentId, d.id);
    const result = await searchContent(
      f.db,
      "events",
      { query: title, limit: 3 },
      "2026-11-17T09:00:00+08:00",
    );
    const activity = result.activities.find((a) => a.documentId === d.id)!;
    expect(activity.eventId).toBe(currentId);
    expect(activity.calendarUrl).toContain("event=" + currentId);
    expect(activity.calendarUrl).toContain("article=link-event");
    expect(
      (await readCalendar(f.db, { event: activity.eventId })).items,
    ).toHaveLength(1);
  } finally {
    f.close();
  }
});

it("keeps a named venue even when the article never repeats it in the title", async () => {
  const f = await dateGateFixture();
  try {
    const venue = await f.store.document("spring");
    await f.db.batch(
      await analysisStatements(
        f.db,
        venue.id,
        venue.contentRevision,
        venue.inputHash!,
        {
          title: "职引未来，逐梦启航——公管学院举办求职技能系列讲座",
          body: "讲座时间：2026年11月11日19:00。地点：大学城校区学术交流中心 MPA 第一会议室。",
        },
      ),
    );
    const elsewhere = await f.store.document("autumn");
    await f.db.batch(
      await analysisStatements(
        f.db,
        elsewhere.id,
        elsewhere.contentRevision,
        elsewhere.inputHash!,
        {
          title: "2026年青年师生思政微课大赛",
          body: "比赛时间：2026年11月12日14:00。地点：大学城校区图书馆报告厅。",
        },
      ),
    );
    const result = await calendarContentSearch(
      f.db,
      EventSearchInputSchema.parse({
        query: "学术交流中心最近两周有什么活动",
        after: "2026-11-09",
        before: "2026-11-23",
        timeRole: "event",
        limit: 5,
      }),
      "2026-11-21T00:00:00Z",
    );
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0].placeRaw).toContain("学术交流中心");
  } finally {
    f.close();
  }
});

it("ranks the named competition above an earlier college sign-up notice", async () => {
  const f = await dateGateFixture();
  try {
    for (const [id, title, day] of [
      ["spring", "挑战杯 | 会计学院“大挑”选拔赛正式报名通知", "2026-11-07"],
      [
        "autumn",
        "2026-2027学年“挑战杯”广外大学生课外学术科技创新大赛",
        "2026-11-19",
      ],
    ] as const) {
      const d = await f.store.document(id);
      await f.db.batch(
        await analysisStatements(
          f.db,
          d.id,
          d.contentRevision,
          d.inputHash!,
          {
            title,
            body: `比赛时间：${day}。地点：大学城校区。`,
          },
        ),
      );
    }
    const result = await calendarContentSearch(
      f.db,
      EventSearchInputSchema.parse({
        query: "挑战杯比赛什么时候举办",
        after: "2026-11-01",
        before: "2026-11-30",
        timeRole: "event",
        limit: 5,
      }),
      "2026-11-21T00:00:00Z",
    );
    expect(result.activities[0].name).toContain("大学生课外学术科技创新大赛");
    expect(result.activities[0].startsAt?.date).toBe("2026-11-19");
  } finally {
    f.close();
  }
});

it("drops a call for papers from a lecture listing", async () => {
  const f = await dateGateFixture();
  try {
    for (const [id, title, day] of [
      [
        "spring",
        "征文启事 | 第七届全国高校国际贸易学科协作组国际商务论坛征文通知",
        "2026-11-22",
      ],
      [
        "autumn",
        "讲座预告 | 馆藏资源检索方法",
        "2026-11-20",
      ],
    ] as const) {
      const d = await f.store.document(id);
      await f.db.batch(
        await analysisStatements(
          f.db,
          d.id,
          d.contentRevision,
          d.inputHash!,
          { title, body: `讲座时间：${day}。地点：白云山校区明德报告厅。` },
        ),
      );
    }
    const result = await calendarContentSearch(
      f.db,
      EventSearchInputSchema.parse({
        query: "最近有什么讲座",
        after: "2026-11-19",
        before: "2026-12-05",
        timeRole: "event",
        limit: 5,
      }),
      "2026-11-21T00:00:00Z",
    );
    expect(result.activities.length).toBeGreaterThan(0);
    expect(
      result.activities.every((a) => !/征文|征稿|启事/.test(a.name)),
    ).toBe(true);
    expect(result.activities.some((a) => /馆藏资源检索方法/.test(a.name))).toBe(
      true,
    );
  } finally {
    f.close();
  }
});

it("keeps calls for papers out of a lexical lecture listing", async () => {
  const { searchContent } = await import("@/lib/server/retrieval/skills");
  const f = await dateGateFixture();
  try {
    for (const [id, title] of [
      [
        "spring",
        "征文启事 | 第七届全国高校国际贸易学科协作组国际商务论坛征文通知",
      ],
      [
        "autumn",
        "会议预告 | 第七届全国高校国际贸易学科协作组国际商务论坛",
      ],
    ] as const) {
      const d = await f.store.document(id);
      await f.db.batch(
        await analysisStatements(
          f.db,
          d.id,
          d.contentRevision,
          d.inputHash!,
          { title, body: "讲座时间：2026-11-22。地点：白云山校区明德报告厅。" },
        ),
      );
    }
    const result = await searchContent(
      f.db,
      "events",
      { query: "讲座", limit: 5 },
      "2026-11-21T00:00:00+08:00",
    );
    expect(
      result.hits.every((h) => !/征文|征稿|启事/.test(h.title)),
    ).toBe(true);
  } finally {
    f.close();
  }
});

it("keeps calls for papers out of the direct lecture listing", async () => {
  const f = await dateGateFixture();
  try {
    for (const [id, title] of [
      [
        "spring",
        "征文启事 | 第七届全国高校国际贸易学科协作组国际商务论坛征文通知",
      ],
      ["autumn", "讲座预告 | 馆藏资源检索方法"],
    ] as const) {
      const d = await f.store.document(id);
      await f.db.batch(
        await analysisStatements(
          f.db,
          d.id,
          d.contentRevision,
          d.inputHash!,
          {
            title,
            body: "讲座时间：2026-11-22。地点：白云山校区明德报告厅。",
          },
        ),
      );
    }
    const result = await upcomingEvents(
      f.db,
      "最近有什么讲座",
      undefined,
      Date.parse("2026-11-21T00:00:00+08:00"),
    );
    expect(result?.text).toContain("馆藏资源检索方法");
    expect(result?.text).not.toContain("征文");
  } finally {
    f.close();
  }
});

it("lists a recently held lecture instead of claiming the calendar is empty", async () => {
  const f = await dateGateFixture();
  try {
    const d = await f.store.document("autumn");
    await f.db.batch(
      await analysisStatements(f.db, d.id, d.contentRevision, d.inputHash!, {
        title: "职引未来，逐梦启航——公管学院举办求职技能系列讲座",
        body: "讲座时间：2026-11-11。地点：学术交流中心 MPA 第一会议室。",
      }),
    );
    const result = await upcomingEvents(
      f.db,
      "最近有什么讲座",
      undefined,
      Date.parse("2026-11-21T00:00:00+08:00"),
    );
    expect(result?.text).toContain("求职技能系列讲座");
    expect(result?.text).toContain("2026-11-11");
    expect(result?.text).toContain("已举办");
    expect(result?.text).not.toContain("没有找到");
  } finally {
    f.close();
  }
});

it("shows the full span of an ongoing competition in this week's list", async () => {
  const f = await dateGateFixture();
  try {
    const d = await f.store.document("autumn");
    await f.db.batch(
      await analysisStatements(f.db, d.id, d.contentRevision, d.inputHash!, {
        title: "红色演艺大赛",
        body: "比赛时间：2026-10-15 至 2026-11-29。地点：大学城校区。",
      }),
    );
    const result = await upcomingEvents(
      f.db,
      "这周有哪些比赛",
      undefined,
      Date.parse("2026-11-21T00:00:00+08:00"),
    );
    expect(result?.text).toContain("红色演艺大赛");
    expect(result?.text).toContain("2026-10-15 至 2026-11-29");
    expect(result?.text).toContain("进行中");
  } finally {
    f.close();
  }
});

it("keeps a recruitment briefing out of a lecture listing", async () => {
  const f = await dateGateFixture();
  try {
    const d = await f.store.document("autumn");
    await f.db.batch(
      await analysisStatements(f.db, d.id, d.contentRevision, d.inputHash!, {
        title: "【11月12日宣讲】中铁二十五局集团有限公司",
        body: "宣讲时间：2026-11-12 14:30。地点：大学城校区E301。",
      }),
    );
    const result = await upcomingEvents(
      f.db,
      "最近有什么讲座",
      undefined,
      Date.parse("2026-11-21T00:00:00+08:00"),
    );
    expect(result?.text).not.toContain("宣讲");
    expect(result?.text).not.toContain("中铁二十五局");
  } finally {
    f.close();
  }
});

it("routes a recent lecture listing through the calendar index", async () => {
  const { searchContent } = await import("@/lib/server/retrieval/skills");
  const f = await dateGateFixture();
  try {
    for (const [id, title, day] of [
      [
        "spring",
        "征文启事 | 第七届全国高校国际贸易学科协作组国际商务论坛征文通知",
        "2026-11-22",
      ],
      [
        "autumn",
        "讲座预告 | 馆藏资源检索方法",
        "2026-11-20",
      ],
    ] as const) {
      const d = await f.store.document(id);
      await f.db.batch(
        await analysisStatements(
          f.db,
          d.id,
          d.contentRevision,
          d.inputHash!,
          { title, body: `讲座时间：${day}。地点：白云山校区明德报告厅。` },
        ),
      );
    }
    const result = await searchContent(
      f.db,
      "events",
      {
        query: "最近有什么讲座",
        limit: 5,
        publishedAfter: "2026-11-14",
        publishedBefore: "2026-11-21",
      },
      "2026-11-21T00:00:00+08:00",
    );
    expect(result.activities.length).toBeGreaterThan(0);
    expect(
      result.activities.every((a) => !/征文|征稿|启事/.test(a.name)),
    ).toBe(true);
  } finally {
    f.close();
  }
});

it("routes a named competition timing question through the calendar index", async () => {
  const { searchContent } = await import("@/lib/server/retrieval/skills");
  const f = await dateGateFixture();
  try {
    for (const [id, title, day] of [
      ["spring", "挑战杯 | 会计学院“大挑”选拔赛正式报名通知", "2026-11-07"],
      [
        "autumn",
        "2026-2027学年“挑战杯”广外大学生课外学术科技创新大赛",
        "2026-11-19",
      ],
    ] as const) {
      const d = await f.store.document(id);
      await f.db.batch(
        await analysisStatements(
          f.db,
          d.id,
          d.contentRevision,
          d.inputHash!,
          { title, body: `比赛时间：${day}。地点：大学城校区。` },
        ),
      );
    }
    const result = await searchContent(
      f.db,
      "events",
      { query: "挑战杯比赛什么时候举办", limit: 5 },
      "2026-11-21T00:00:00+08:00",
    );
    expect(result.activities[0].name).toContain(
      "大学生课外学术科技创新大赛",
    );
    expect(result.activities[0].startsAt?.date).toBe("2026-11-19");
  } finally {
    f.close();
  }
});

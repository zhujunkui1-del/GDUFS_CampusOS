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
    expect(r.items[0].mapPlace).toBeNull();
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

it("shows a notice without hours once per day, and keeps stated sessions apart", async () => {
  const f = await dateGateFixture();
  try {
    const [a, b] = [await f.store.document("spring"), await f.store.document("autumn")];
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
            text:
              "日期 | 地点 | 项目名称\n2026年11月5日 | 田径场 | 男子百米\n2026年11月5日 | 体育馆 | 女子篮球\n2026年11月6日 | 田径场 | 决赛",
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
            text:
              "序号 | 日期 | 开始时间 | 单位名称 | 地点 | 形式\n1 | 2026年11月5日 | 15:30 | 甲公司 | 一教109 | 宣讲\n2 | 2026年11月5日 | 19:00 | 乙公司 | 一教109 | 宣讲",
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

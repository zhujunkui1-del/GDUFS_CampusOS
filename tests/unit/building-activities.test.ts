import { it, expect } from "vitest";
import { dateGateFixture, command } from "../fixtures/date-gate";
import { analysisStatements } from "@/lib/server/console/article-analysis";
import { readCalendar } from "@/lib/server/calendar/query";

it("links recent and future Baiyun aliases to their building while separating University Town", async () => {
  const f = await dateGateFixture();
  try {
    for (const [id, body] of [
      [
        "spring",
        "讲座时间：2026年11月18日15:30至17:00。地点：白云山校区一教南楼117。",
      ],
      [
        "autumn",
        "讲座时间：2027年2月3日15:00至16:00。地点：白云山校区第一教学楼101。",
      ],
      [
        "white",
        "讲座时间：2026年11月19日15:00至16:00。地点：大学城校区教学楼A栋101。",
      ],
    ]) {
      const d = await f.store.document(id);
      await f.db.batch(
        await analysisStatements(f.db, d.id, d.contentRevision, d.inputHash!, {
          title: "讲座预告",
          body,
          publishedAt: "2026-11-01",
        }),
      );
    }
    const result = await readCalendar(
      f.db,
      { placeId: "osm-way-338028591", limit: 50 },
      "2026-11-18T12:00:00+08:00",
    );
    expect(result.total).toBe(2);
    expect(
      result.items.every((item) => item.mapPlace?.campus === "baiyun"),
    ).toBe(true);
  } finally {
    f.close();
  }
});

it("uses the rolling fourteen-day lower bound, retains its boundary, and includes dates beyond a month", async () => {
  const f = await dateGateFixture();
  const now = "2026-11-14T21:00:00+08:00";
  try {
    for (const [id, date] of [
      ["spring", "2026年11月14日"],
      ["autumn", "2027年2月3日"],
      ["white", "2026年10月30日"],
    ]) {
      const d = await f.store.document(id);
      await f.db.batch(
        await analysisStatements(f.db, d.id, d.contentRevision, d.inputHash!, {
          title: "讲座预告 " + id,
          body: `讲座时间：${date}15:00至16:00。\n地点：大学城校区院系楼401会议室。`,
          publishedAt: "2026-10-01",
        }),
      );
    }
    const q = { placeId: "osm-way-307437431", limit: 1 };
    const first = await readCalendar(f.db, q, now);
    expect(first.after).toBe("2026-10-31");
    expect(first.total).toBe(2);
    expect(first.hasMore).toBe(true);
    expect(first.items[0].sources[0].documentId).toBe("spring");
    expect(first.items[0].historical).toBe(true);
    const second = await readCalendar(
      f.db,
      { ...q, limit: 50, cursor: first.nextCursor },
      now,
    );
    expect(second.items[0].activity.startsAt?.date).toBe("2027-02-03");
    expect(second.hasMore).toBe(false);
    const future = await f.store.document("autumn");
    await f.store.publish(
      future.id,
      { ...command(future.version), note: "本地撤回验收" },
      true,
    );
    expect((await readCalendar(f.db, { placeId: q.placeId }, now)).total).toBe(
      1,
    );
    expect(
      (await readCalendar(f.db, { placeId: q.placeId }, "2026-11-28T16:01:00Z"))
        .total,
    ).toBe(0);
  } finally {
    f.close();
  }
});

it("rolls E/F/G activities up to their shared building, keeps individual wings separate, and ignores other buildings", async () => {
  const f = await dateGateFixture();
  try {
    for (const [id, location] of [
      ["spring", "大学城校区E203"],
      ["autumn", "大学城校区G座教学楼207"],
      ["white", "广东外语外贸大学南校区D512课室"],
    ]) {
      const d = await f.store.document(id);
      await f.db.batch(
        await analysisStatements(f.db, d.id, d.contentRevision, d.inputHash!, {
          title: "讲座预告 " + id,
          body: `讲座时间：2026年11月15日15:00。\n地点：${location}。`,
          publishedAt: "2026-10-01",
        }),
      );
    }
    const now = "2026-11-14T00:00:00+08:00";
    expect(
      (await readCalendar(f.db, { placeId: "osm-relation-4105730" }, now))
        .total,
    ).toBe(2);
    const e = await readCalendar(f.db, { placeId: "osm-node-3125704419" }, now);
    expect(e.total).toBe(1);
    expect(e.items[0].sources[0].documentId).toBe("spring");
    await expect(
      readCalendar(f.db, { placeId: "nonexistent" }, now),
    ).rejects.toThrow("建筑不存在");
  } finally {
    f.close();
  }
});

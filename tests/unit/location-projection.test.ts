import { it, expect } from "vitest";
import layouts from "../fixtures/location-layouts.json";
import { articleLocation } from "@/lib/ingestion/calendar-extraction";
import { articleMapPlace } from "@/lib/retrieval/activity-place";
import { campusData } from "@/features/campus-map/data/campus";
import { dateGateFixture } from "../fixtures/date-gate";
import { analysisStatements } from "@/lib/server/console/article-analysis";
import { readCalendar } from "@/lib/server/calendar/query";

it.each(layouts)(
  "extracts the independent address block in $title",
  (entry) => {
    const result = articleLocation({ title: entry.title, body: entry.body });
    expect(result?.place).toBe(entry.place);
    expect(
      entry.body.slice(
        result!.evidence.startOffset,
        result!.evidence.endOffset,
      ),
    ).toBe(entry.place);
  },
);
it("derives room matching from every teaching building in the gazetteer for arbitrary room numbers", () => {
  for (const place of campusData.places.filter((p) =>
    /^教学楼[A-Z]栋$/.test(p.name),
  )) {
    const letter = place.name.match(/[A-Z]/)![0];
    for (let room = 101; room < 990; room += 37)
      expect(articleMapPlace(`大学城校区${letter}${room}`)?.placeId).toBe(
        place.id,
      );
  }
  expect(articleMapPlace("学术交流中心 MPA 第一会议室")?.name).toBe(
    "学术交流中心",
  );
});
it("fills an old missing index venue from the current permitted D1 body without rewriting dates or records", async () => {
  const body = "讲座时间：2026年11月11日15:00。\n大学城校区F105\n形式\n宣讲会";
  const f = await dateGateFixture(body);
  try {
    const d = await f.store.document("spring");

    await f.db.batch(
      await analysisStatements(f.db, d.id, d.contentRevision, d.inputHash!, {
        title: "2026年讲座通知",
        body,
        publishedAt: "2026-11-01",
      }),
    );
    f.sqlite
      .prepare(
        "UPDATE article_activity_index SET activity_json=json_set(activity_json,'$.placeRaw',NULL) WHERE document_id=?",
      )
      .run(d.id);
    const result = await readCalendar(
      f.db,
      { day: "2026-11-11" },
      "2026-11-15T00:00:00+08:00",
    );
    expect(result.items[0].activity.placeRaw).toBe("大学城校区F105");
    expect(result.items[0].mapPlace?.name).toBe("教学楼F栋");
    expect(result.metrics.rowsWritten).toBe(0);
  } finally {
    f.close();
  }
});

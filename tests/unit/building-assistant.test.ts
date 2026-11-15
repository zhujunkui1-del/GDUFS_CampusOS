import questions from "../../docs/BUILDING_ASSISTANT_30_QUESTIONS_2026_11_15.json";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import { it, expect } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import {
  buildingEvidence,
  buildingActivityCards,
  citeMentionedBuildingActivities,
  mentionedBuildingIds,
} from "@/lib/server/assistant/building-evidence";
import { citedAnswer } from "@/lib/server/assistant/citations";

it("keeps the calendar link for a named event even if the generated answer missed its citation", () => {
  const events = ["讲座预告｜求职技能系列讲座", "艺术节作品展示"].map(
    (title, index) => ({
      title,
      startsAt: { date: "2026-11-11", at: null },
      endsAt: null,
      place: "学术交流中心",
      historical: true,
      calendarUrl: `/calendar?date=2026-11-11&event=event-${String(index).repeat(40)}`,
      sources: [
        {
          documentId: `doc-${index}`,
          title,
          url: `https://example.invalid/${index}`,
          name: "公管学院",
          publishedAt: null,
          readable: true,
        },
      ],
    }),
  );
  const cards = buildingActivityCards(events);
  const result = citedAnswer(
    citeMentionedBuildingActivities(
      "11月11日举办了公管学院的求职技能系列讲座。",
      cards,
    ),
    cards,
  );
  expect(result.text).toContain("活动链接 [1]");
  expect(result.cards).toHaveLength(1);
  expect(result.cards[0]).toMatchObject({
    documentId: "doc-0",
    calendarLinks: [{ href: events[0].calendarUrl }],
  });
});
it("reads current owner edits rather than a frozen prompt copy and excludes private feedback", async () => {
  const f = sqliteD1();
  try {
    const id = "osm-way-307250998";
    const save = f.sqlite.prepare(
      "INSERT INTO building_profiles(place_id,description,photos_json,updated_at) VALUES(?,?,'[]',?) ON CONFLICT(place_id) DO UPDATE SET description=excluded.description",
    );
    save.run(id, "当前介绍：阅读与自习。", new Date().toISOString());
    expect(
      (await buildingEvidence(f.db, "图书馆有哪些设施？"))[0].description,
    ).toContain("阅读与自习");
    save.run(id, "修改后的建筑介绍。", new Date().toISOString());
    f.sqlite
      .prepare(
        "INSERT INTO project_feedback(id,nickname,content,submitted_at) VALUES('private','','不能泄露的私人留言',?)",
      )
      .run(new Date().toISOString());
    const value = await buildingEvidence(f.db, "图书馆介绍一下");
    expect(value[0].description).toBe("修改后的建筑介绍。");
    expect(JSON.stringify(value)).not.toContain("私人留言");
    expect(value[0].activityWindowStart).toBeTruthy();
  } finally {
    f.close();
  }
});
it("uses a verified selected place for here, and does not attach building facts to unrelated conversation", async () => {
  expect(mentionedBuildingIds("这栋楼有什么？", "osm-way-307250998")).toEqual([
    "osm-way-307250998",
  ]);
  const f = sqliteD1();
  try {
    expect(await buildingEvidence(f.db, "你好啊")).toEqual([]);
  } finally {
    f.close();
  }
});

it("keeps the thirty measured building questions outside the pre-existing formal-policy route", () => {
  for (const item of questions) {
    const plan = contentIntent(item.question, []).queryPlan;
    expect(plan.campus, item.question).not.toBe("north");
    expect(plan.goal, item.question).not.toBe("policy");
    expect(
      plan.topics.some((topic) => topic.id === "borrowing"),
      item.question,
    ).toBe(false);
  }
});

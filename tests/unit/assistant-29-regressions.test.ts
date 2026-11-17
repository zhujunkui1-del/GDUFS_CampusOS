import { it, expect } from "vitest";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import { requestTimeWindow } from "@/lib/server/assistant/time-window";
import { contentReadPlan } from "@/lib/server/assistant/read-plan";
import { externalPolicy } from "@/lib/server/external-search/policy";
import { dateGateFixture } from "../fixtures/date-gate";
import { analysisStatements } from "@/lib/server/console/article-analysis";
import { searchContent } from "@/lib/server/retrieval/skills";
import { spatialReadKind } from "@/lib/server/assistant/spatial-reads";
import {
  emptyEventWindowAnswer,
  participationEvidenceAnswer,
} from "@/lib/server/assistant/evidence-answer";
import { expressionConflicts } from "@/lib/server/assistant/grounding";

it("keeps date, campus, registration and event status as independent constraints", () => {
  const now = Date.parse("2026-11-17T10:00:00+08:00");
  expect(
    requestTimeWindow("这周末南校区有什么活动可以参加", now),
  ).toMatchObject({ after: "2026-11-21", before: "2026-11-22", role: "event" });
  const question = "广外最近有哪些已经截止报名但还没有正式开始的比赛？";
  const plan = contentReadPlan(
    ["search_campus_events"],
    question,
    externalPolicy(question),
    () => false,
  );
  expect(plan[0].input).toMatchObject({
    registrationState: "closed",
    eventState: "upcoming",
  });
  const campus = "这周末南校区有什么活动可以参加";
  expect(contentIntent(campus, [], now).retrievalQuery).toBe("活动");
  expect(
    contentReadPlan(
      ["search_campus_events"],
      campus,
      externalPolicy(campus),
      () => false,
      contentIntent(campus, [], now).retrievalQuery,
    )[0].input,
  ).toMatchObject({
    query: "活动",
    campus: "university_town",
    registrationState: "open",
  });
});

it("routes facility comparisons and scoped follow-ups independently from policy procedures", () => {
  expect(contentIntent("南校区距离图书馆最近的食堂是哪一个？").map).toBe(true);
  expect(
    spatialReadKind("南校区距离图书馆最近的食堂是哪一个？", []),
  ).toBe("nearest_canteen");
  expect(contentIntent("广外南校区有哪些体育场地？分别在哪里？").map).toBe(
    true,
  );
  const document = contentIntent("广外学生证丢失了应该怎么办？在哪里补办？");
  expect(document.tools).toContain("search_campus_knowledge");
  expect(document.queryPlan.topics.map((t) => t.id)).toContain("student_id");
  expect(
    contentIntent(
      "广外最近有哪些人工智能相关的讲座或竞赛？帮我区分哪些可以报名、哪些只是新闻报道。",
    ).articleLookup,
  ).toBe(false);
  expect(
    contentIntent("广外有没有保证参加就一定获奖的竞赛？").answerRequirement,
  ).toBe("advisory");
  const history = [
    {
      id: "a",
      sequence: 1,
      role: "user" as const,
      text: "广外有哪些奖学金？",
      cards: [],
    },
  ];
  const next = contentIntent("那国家奖学金具体需要什么条件？", history);
  expect(next.query).toContain("国家奖学金");
  expect(next.query).not.toContain("有哪些");
  expect(next.queryPlan.goal).toBe("requirements");
});

it("keeps multiple verified passages of a long reference available to answer generation", async () => {
  const f = await dateGateFixture();
  try {
    const title = "校园奖学金制度手册";
    const body =
      "第一章 奖学金条件\n国家奖学金申请条件：申请人学习成绩应当符合规定。\n" +
      "校园其他事务。".repeat(500) +
      "\n第二章 奖学金评选\n学业奖学金申请条件：申请人无课程不及格记录。\n" +
      "校园其他事务。".repeat(500) +
      "\n第三章 社会奖学金\n社会奖学金申请条件：按出资方要求提交证明材料。";
    await f.article("multi-passages", "2026-11-01", title, body);
    const d = await f.store.document("multi-passages");
    await f.db.batch(
      await analysisStatements(
        f.db,
        d.id,
        d.contentRevision,
        d.inputHash!,
        { title, body, publishedAt: "2026-11-01" },
        undefined,
        "licensed_full_text",
      ),
    );
    const result = await searchContent(f.db, "knowledge", {
      query: "奖学金申请条件",
      title,
      limit: 3,
    });
    const hit = result.hits[0];
    expect(hit.supportingPassages?.length).toBeGreaterThan(0);
    for (const passage of hit.supportingPassages ?? []) {
      expect(body.slice(passage.startOffset, passage.endOffset)).toBe(
        passage.text,
      );
    }
  } finally {
    f.close();
  }
});

it("returns outdoor and indoor sports places from the reviewed map category", async () => {
  const { CampusMapService } =
    await import("@/lib/server/maps/campus-map-service");
  const { placeLayer } = await import("@/features/campus-map/data/campus");
  const service = new CampusMapService();
  const result = service.search(
    { query: "体育场地", limit: 20 },
    {
      requestId: "isolated",
      sessionId: "isolated",
      user: null,
      permissions: [],
      campusId: "gdufs_university_town",
    },
  );
  expect(result.matches.length).toBeGreaterThan(2);
  for (const place of result.matches)
    expect([
      "sports_hall",
      "swimming",
      "track",
      "football",
      "basketball",
      "volleyball",
      "badminton",
      "tennis",
      "sports",
    ]).toContain(place.category);
  expect(result.matches.some((place) => place.category === "basketball")).toBe(
    true,
  );
  expect(
    placeLayer({ category: "basketball" } as Parameters<typeof placeLayer>[0]),
  ).toBe("sports");
});

it("lists scheduled activities without treating notices as events to attend", () => {
  const results = [
    {
      activities: [
        {
          documentId: "lecture",
          name: "传播学讲座",
          kind: "lecture",
          eventStatus: "unknown",
          historical: false,
          registrationState: "unknown",
          startsAt: { date: "2026-11-22", at: null },
          endsAt: null,
          registrationWindows: [],
        },
        {
          documentId: "notice",
          name: "停课通知",
          kind: "notice",
          category: "campus_notice",
          eventStatus: "unknown",
          historical: false,
          registrationState: "unknown",
          startsAt: { date: "2026-11-22", at: null },
          endsAt: null,
          registrationWindows: [],
        },
      ],
    },
  ] as unknown as import("@/domain/retrieval/skills").ContentSearchResult[];
  const cards = ["lecture", "notice"].map((documentId) => ({
    kind: "source",
    documentId,
    title: documentId === "notice" ? "停课通知" : "传播学讲座",
    snippet: "",
  })) as unknown as import("@/domain/agent/assistant-contracts").AssistantCard[];
  const result = participationEvidenceAnswer(
    cards,
    results,
    Date.parse("2026-11-17T10:00:00+08:00"),
    "这周末南校区有什么活动可以参加？",
  );
  expect(result.text).toContain("传播学讲座");
  expect(result.text).toContain("报名状态尚未核实");
  expect(result.text).not.toContain("停课通知");
  expect(result.taskStatus).toBe("partial");
});

it("reports an empty filtered event search without claiming campus-wide absence", () => {
  const answer = emptyEventWindowAnswer(
    { after: "2026-11-17", before: "2026-12-17" },
    "竞赛",
    ["报名已截止", "活动尚未正式开始"],
  );
  expect(answer).toContain("报名已截止、活动尚未正式开始");
  expect(answer).toContain("不能据此断定没有这类活动");
  expect(expressionConflicts(answer, "serious", 0)).toEqual([]);
});

it("uses a verified place selected earlier in the same run as the nearby origin", async () => {
  const { CampusMapService } =
    await import("@/lib/server/maps/campus-map-service");
  const { createMapSkillRegistry } = await import("@/lib/server/maps/skills");
  const registry = createMapSkillRegistry(
    new CampusMapService(),
    undefined,
    () => "osm-way-307250998",
  );
  const result = await registry.get("find_nearby_places")!.run(
    {
      origin: { type: "selected_place" },
      category: "canteen",
      radiusMeters: 2000,
      limit: 3,
    },
    {
      requestId: "isolated",
      sessionId: "isolated",
      user: null,
      permissions: [],
      campusId: "gdufs_university_town",
    },
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    const data = result.data as {
      origin: { placeId: string };
      matches: { category: string }[];
    };
    expect(data.origin.placeId).toBe("osm-way-307250998");
    expect(data.matches.length).toBeGreaterThan(0);
    expect(data.matches.every((place) => place.category === "canteen")).toBe(
      true,
    );
  }
});

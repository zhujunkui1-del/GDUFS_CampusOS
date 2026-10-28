import { it, expect } from "vitest";
import { dateGateFixture } from "../fixtures/date-gate";
import {
  retrievalCorpus,
  retrievalQuestions,
} from "../fixtures/retrieval-evaluation";
import { ensureRetrievalIndex } from "@/lib/server/retrieval/indexer";
import { searchContent } from "@/lib/server/retrieval/skills";
import { buildQueryPlan, queryRelevance } from "@/lib/retrieval/query-plan";
import {
  assessEvidence,
  activityAvailability,
  falseNegativeAnswer,
} from "@/lib/retrieval/evidence-assessment";
import { completeSnippetTimes } from "@/lib/retrieval/snippet-time";
import { analyzeArticle } from "@/lib/ingestion/article-analysis";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import { ContentSearchResultSchema } from "@/domain/retrieval/skills";
import { analysisStatements } from "@/lib/server/console/article-analysis";
import {
  isDiscoveryIndex,
  unsupportedClosureClaim,
} from "@/lib/retrieval/temporal-claims";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";

it("evaluates a shared cross-topic corpus and preserves qualification under distractors", async () => {
  const f = await dateGateFixture();
  try {
    for (const [id, title, body] of retrievalCorpus) {
      f.sqlite
        .prepare(
          `INSERT INTO knowledge_documents(id,source_id,title,url,body,body_format,body_status,content_hash,fetched_at,campus_scope,data_domain,published_at,content_revision,input_hash,rights_scope,content_type,radar_category) VALUES(?,?,?,?,?,'plain','complete',?,'2026-10-10','all','campus_announcements','2026-10-10',1,?,'licensed_full_text','notice','competition')`,
        )
        .run(
          id,
          f.source.id,
          title,
          "https://example.invalid/" + id,
          body,
          id,
          "c".repeat(64),
        );
      await f.store.publishCollectedWebArticle(id);
      f.sqlite
        .prepare("DELETE FROM knowledge_chunks WHERE document_id=?")
        .run(id);
      f.sqlite
        .prepare("DELETE FROM article_search_documents WHERE document_id=?")
        .run(id);
      await ensureRetrievalIndex(f.db, id);
      await f.db.batch(
        await analysisStatements(f.db, id, 1, "c".repeat(64), {
          title,
          body,
          publishedAt: "2026-10-10",
        }),
      );
    }
    const day = await searchContent(
      f.db,
      "events",
      {
        query: "广外讲座",
        after: "2026-11-04",
        before: "2026-11-04",
        limit: 4,
      },
      "2026-10-28T06:00:00Z",
    );
    expect(day.hits.map((h) => h.documentId)).toEqual(["lecture"]);
    const differentDay = await searchContent(
      f.db,
      "events",
      {
        query: "广外讲座",
        after: "2026-11-05",
        before: "2026-11-05",
        limit: 4,
      },
      "2026-10-28T06:00:00Z",
    );
    expect(differentDay.hits).toHaveLength(0);
    const naturalDay = await searchContent(
      f.db,
      "events",
      { query: "今天的广外讲座", limit: 4 },
      "2026-11-04T06:00:00Z",
    );
    expect(naturalDay.hits.map((h) => h.documentId)).toEqual(["lecture"]);
    const otherNaturalDay = await searchContent(
      f.db,
      "events",
      { query: "今天的广外讲座", limit: 4 },
      "2026-11-05T06:00:00Z",
    );
    expect(otherNaturalDay.hits).toHaveLength(0);
    const recoveredDate = await searchContent(
      f.db,
      "events",
      {
        query: "定向越野比赛",
        after: "2026-10-11",
        before: "2026-10-11",
        limit: 4,
      },
      "2026-10-28T06:00:00Z",
    );
    expect(recoveredDate.hits.some((h) => h.documentId === "old-sport")).toBe(
      true,
    );
    for (const [query, expected, purpose] of retrievalQuestions) {
      const r = await searchContent(
        f.db,
        purpose,
        { query, limit: 4 },
        "2026-10-28T06:00:00Z",
      );
      expect(
        r.hits.some((h) =>
          (expected as readonly string[]).includes(h.documentId),
        ),
        query,
      ).toBe(true);
      expect(r.metrics.candidateChunks).toBeLessThanOrEqual(96);
      expect(r.metrics.rowsWritten).toBe(0);
      if (/足球|停水|三方协议/.test(query))
        expect(
          r.hits.every((h) =>
            (expected as readonly string[]).includes(h.documentId),
          ),
          query,
        ).toBe(true);
    }
  } finally {
    f.close();
  }
});
it.each([
  ["体育比赛", "信息安全大赛", false],
  ["比赛", "信息安全大赛", true],
  ["足球比赛", "羽毛球比赛", false],
  ["羽毛球比赛", "羽毛球比赛", true],
  ["停水通知", "专项用电施工", false],
  ["停电通知", "专项用电施工", true],
  ["就业协议办理", "秋季招聘宣讲会", false],
  ["招聘信息", "秋季招聘宣讲会", true],
  ["大学城校区讲座", "白云山校区讲座", false],
  ["白云山校区讲座", "白云山校区讲座", true],
])("metamorphic topic/scope: %s -> %s", (query, title, expected) =>
  expect(queryRelevance(buildQueryPlan(query), { title }).relevant).toBe(
    expected,
  ),
);
it("represents follow-up context and goal separately from subjects", () => {
  const history = [
    {
      id: "fixture",
      role: "user" as const,
      text: "本科生奖学金申请条件是什么",
      cards: [],
    },
  ];
  const c = contentIntent("那需要准备什么材料？", history);
  expect(buildQueryPlan(c.query).topics[0].id).toBe("scholarship");
  expect(buildQueryPlan(c.query).goal).toBe("requirements");
  expect(buildQueryPlan("体育比赛，不要足球").excludedTerms).toContain("足球");
});
it("preserves previously unknown subject modifiers, independently of the broad event words", () => {
  expect(
    queryRelevance(buildQueryPlan("人工智能讲座"), {
      title: "金融学讲座预告",
      contentSnippet: "经济分析",
    }).relevant,
  ).toBe(false);
  expect(
    queryRelevance(buildQueryPlan("人工智能讲座"), {
      title: "AI讲坛预告",
      contentSnippet: "大模型介绍",
    }).relevant,
  ).toBe(true);
  expect(
    queryRelevance(buildQueryPlan("信息安全比赛"), {
      title: "CFA投资分析大赛",
      contentSnippet: "金融比赛",
    }).relevant,
  ).toBe(false);
  expect(
    queryRelevance(buildQueryPlan("英语演讲比赛"), {
      title: "英语演讲竞赛报名通知",
    }).relevant,
  ).toBe(true);
  expect(
    queryRelevance(buildQueryPlan("女子双打羽毛球比赛"), {
      title: "羽毛球男子单打比赛",
    }).relevant,
  ).toBe(false);
  expect(
    queryRelevance(buildQueryPlan("羽毛球比赛还能报名吗"), {
      title: "新生生活地图",
      contentSnippet: "学生可以参加羽毛球协会，学校有羽毛球场。",
    }).relevant,
  ).toBe(false);
});
it("does not bind several months of an index page to one event or turn a start into closure", () => {
  expect(
    isDiscoveryIndex("https://tyb.gdufs.edu.cn/tzgg.htm", "通知公告-体育部"),
  ).toBe(true);
  expect(
    isDiscoveryIndex(
      "https://tyb.gdufs.edu.cn/info/1032/2918.htm",
      "新生杯羽毛球通知",
    ),
  ).toBe(false);
  const card: AssistantCard = {
    kind: "external_source",
    title: "篮球赛通知",
    sourceName: "体育部",
    originalUrl: "https://tyb.gdufs.edu.cn/info/fixture",
    publishedAt: "2026-03-23",
    snippet: "篮球赛自2026年3月23日起举行。",
    authority: "official",
    evidenceKind: "page_excerpt",
    searchMode: "web",
  };
  expect(
    unsupportedClosureClaim("篮球赛已结束，报名通道已关闭[来源1]", [card], []),
  ).toBe(true);
  expect(
    unsupportedClosureClaim(
      "篮球赛于3月23日开赛，结束时间及当前报名状态未知[来源1]",
      [card],
      [],
    ),
  ).toBe(false);
});
it("distinguishes failed recall, irrelevant candidates, metadata, and missing details", () => {
  const empty = { hits: [], activities: [] };
  expect(assessEvidence("体育比赛", [], { failed: true }).state).toBe(
    "search_failed",
  );
  expect(assessEvidence("体育比赛", [empty]).state).toBe("no_candidates");
  expect(
    assessEvidence("体育比赛", [
      {
        hits: [
          {
            documentId: "a",
            title: "信息安全大赛",
            bodyAvailable: true,
            contentSnippet: "学科比赛",
          },
        ],
        activities: [],
      },
    ]).state,
  ).toBe("off_topic");
  expect(
    assessEvidence("体育比赛", [
      {
        hits: [
          {
            documentId: "s",
            title: "足球比赛",
            bodyAvailable: false,
            contentSnippet: "",
          },
        ],
        activities: [],
      },
    ]).state,
  ).toBe("metadata_or_authority_insufficient");
  const found = {
    hits: [
      {
        documentId: "s",
        title: "足球比赛",
        bodyAvailable: true,
        contentSnippet: "定于10月11日举办足球比赛",
      },
    ],
    activities: [],
  };
  expect(assessEvidence("体育比赛可以参加吗", [found]).state).toBe(
    "related_but_incomplete",
  );
  expect(falseNegativeAnswer("没有体育赛事相关信息", "体育比赛", [found])).toBe(
    true,
  );
  expect(
    falseNegativeAnswer(
      "已有足球比赛通知，但无法确认当前还能报名[来源1]",
      "体育比赛",
      [found],
    ),
  ).toBe(false);
});
it("does not turn a missing indexed date, cutoff or capacity into availability", () => {
  const analysis = analyzeArticle({
    title: "羽毛球比赛通知",
    body: "比赛定于2026年10月31日在大学城校区体育馆举行，报名请见附件。",
    publishedAt: "2026-10-10",
  });
  const hit = {
    bodyAvailable: true,
    contentSnippet:
      "比赛定于2026年10月31日在大学城校区体育馆举行，报名请见附件。",
    startOffset: 0,
  } as Parameters<typeof completeSnippetTimes>[1];
  const completed = completeSnippetTimes(analysis, hit)!;
  expect(completed.activities[0].startsAt?.date).toBe("2026-10-31");
  expect(
    completed.activities[0].registrationWindows[0]?.end ?? null,
  ).toBeNull();
  const parsed = ContentSearchResultSchema.shape.activities.element.parse({
    eventId: "s",
    documentId: "s",
    activityKey: "a",
    name: "羽毛球比赛",
    kind: "event",
    category: "culture_sports",
    startsAt: completed.activities[0].startsAt
      ? {
          ...completed.activities[0].startsAt,
          evidence: completed.activities[0].startsAt.evidence.text,
        }
      : null,
    endsAt: null,
    placeRaw: null,
    organizer: null,
    eventStatus: "unknown",
    historical: false,
    registrationRequirement: "required",
    registrationState: "unknown",
    registrationWindows: [],
    otherDeadlines: [],
    registrationUrl: null,
    evidence: [],
    mapPlace: null,
  });
  const availability = activityAvailability(
    parsed,
    Date.parse("2026-10-28T06:00:00Z"),
  );
  expect(availability.eventState).toBe("upcoming");
  expect(availability.participation).toBe("unknown");
  expect(
    activityAvailability(
      { ...parsed, registrationState: "capacity_unknown" },
      Date.parse("2026-10-28T06:00:00Z"),
    ).participation,
  ).toBe("unknown");
});

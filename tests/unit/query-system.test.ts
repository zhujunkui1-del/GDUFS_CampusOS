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
  supportsAnswerPurpose,
} from "@/lib/retrieval/evidence-assessment";
import { completeSnippetTimes } from "@/lib/retrieval/snippet-time";
import { analyzeArticle } from "@/lib/ingestion/article-analysis";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import { ContentSearchResultSchema } from "@/domain/retrieval/skills";
import { analysisStatements } from "@/lib/server/console/article-analysis";
import {
  isDiscoveryIndex,
  closureNeedsEvidenceReview,
} from "@/lib/retrieval/temporal-claims";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import { retrievedEvidenceAnswer } from "@/lib/server/assistant/evidence-answer";
import { publicQuery } from "@/lib/server/assistant/read-plan";
import { stripSearchControls } from "@/lib/retrieval/query-controls";

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
    queryRelevance(buildQueryPlan("调用小红书来查广外一饭有什么好吃的"), {
      title: "广外一饭推荐",
      contentSnippet: "我喜欢一饭的咕噜肉，好吃。",
    }).relevant,
  ).toBe(true);
  expect(publicQuery("用小红书查广外南校一饭有什么好吃的")).toBe(
    "广外 南校 一饭",
  );
  expect(stripSearchControls("介绍小红书搜索功能")).toBe("介绍小红书搜索功能");
  expect(
    queryRelevance(buildQueryPlan("王常吉是谁"), {
      title: "王常吉教授介绍",
      contentSnippet: "广东外语外贸大学教授",
    }).relevant,
  ).toBe(true);
  expect(
    queryRelevance(buildQueryPlan("戴建业属于南校吗"), {
      title: "戴建业在白云山校区工作",
      contentSnippet: "戴建业",
    }).relevant,
  ).toBe(true);
  expect(
    queryRelevance(buildQueryPlan("云山学术沙龙414期"), {
      title: "云山学术沙龙412期",
    }).relevant,
  ).toBe(false);
  expect(
    queryRelevance(buildQueryPlan("F101讲座"), { title: "F102讲座" }).relevant,
  ).toBe(false);
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
    closureNeedsEvidenceReview(
      "篮球赛已结束，报名通道已关闭[来源1]",
      [card],
      [],
    ),
  ).toBe(true);
  expect(
    closureNeedsEvidenceReview("篮球赛报名通道也已经关闭[来源1]", [card], []),
  ).toBe(true);
  expect(
    closureNeedsEvidenceReview(
      "篮球赛于3月23日开赛，结束时间及当前报名状态未知[来源1]",
      [card],
      [],
    ),
  ).toBe(false);
  const future: AssistantCard = {
    ...card,
    title: "校运动会通知",
    snippet:
      "各单位：为促进校园体育生活。学校定于2026 年 11 月 20—21 日在大学城校区真草体育场举办运动会。报名材料见附件。",
  };
  const fallback = retrievedEvidenceAnswer(
    [card, future],
    "广外有什么体育比赛可以参加吗",
    true,
    new Set(),
  );
  expect(fallback).toContain("11 月 20—21 日");
  expect(fallback).toContain("[2]");
});
it("does not let an official attachment list erase an available attributed procedural guide", () => {
  const guide: AssistantCard = {
    kind: "source",
    documentId: "public-guide",
    title: "2027届电子就业协议操作指南",
    sourceName: "校园媒体",
    originalUrl: "https://example.invalid/guide",
    publishedAt: "2026-10-01",
    snippet: "1.进入申请界面。进入服务小程序，点击电子就业协议并填写申请。",
    evidenceType: "full_text",
    classificationState: "knowledge",
    validity: "unknown",
    readable: true,
  };
  const forms: AssistantCard = {
    kind: "external_source",
    title: "毕业生各就业手续申请表格下载",
    sourceName: "就业中心",
    originalUrl: "https://example.invalid/forms",
    publishedAt: "2019-03-27",
    snippet: "就业协议等手续的表格下载，详情见附件。",
    authority: "official",
    evidenceKind: "page_excerpt",
    searchMode: "web",
  };
  const answer = retrievedEvidenceAnswer(
    [guide, forms],
    "就业协议怎么办理",
    true,
    new Set(),
  );
  expect(supportsAnswerPurpose("就业协议怎么办理", forms)).toBe(false);
  expect(supportsAnswerPurpose("就业协议怎么办理", guide)).toBe(true);
  expect(
    supportsAnswerPurpose("图书馆怎么借书", {
      title: "借还书说明",
      snippet: "读者可用自助借还机。",
    }),
  ).toBe(true);
  expect(answer).toContain("1.进入申请界面");
  expect(answer).toContain("官方身份及现行效力待确认");
  expect(answer!.indexOf("[1]")).toBeLessThan(answer!.indexOf("[2]"));
  expect(
    retrievedEvidenceAnswer(
      [guide],
      "只查官方就业协议怎么办理",
      true,
      new Set(),
    ),
  ).toBeUndefined();
  expect(
    retrievedEvidenceAnswer(
      [{ ...guide, readable: false }],
      "就业协议怎么办理",
      true,
      new Set(),
    ),
  ).toBeUndefined();
  expect(
    retrievedEvidenceAnswer(
      [{ ...guide, evidenceType: "metadata" }],
      "就业协议怎么办理",
      true,
      new Set(),
    ),
  ).toBeUndefined();
});
it("requires borrowing instructions, not a ranked book description with incidental process words", () => {
  expect(
    queryRelevance(buildQueryPlan("广外图书馆怎么借书"), {
      title: "热读排行｜热门借阅",
      contentSnippet:
        "借阅排行推荐《操作指南》，读者可提交书单，了解信用贷款。",
    }).relevant,
  ).toBe(false);
  expect(
    queryRelevance(buildQueryPlan("广外图书馆怎么借书"), {
      title: "新生入馆指南｜图书馆通关手册",
      contentSnippet:
        "新生需先完成闯馆，取得借阅权限。可持本人校园卡在自助借还机借书。",
    }).relevant,
  ).toBe(true);
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

import { expect, it } from "vitest";
import { buildQueryPlan, queryRelevance } from "@/lib/retrieval/query-plan";
import { ftsExpression } from "@/lib/retrieval/terms";
import { dateGateFixture } from "../fixtures/date-gate";
import { ensureRetrievalIndex } from "@/lib/server/retrieval/indexer";
import { searchContent } from "@/lib/server/retrieval/skills";

// The same college is written by its full name in one notice and by its short
// name in another. Asking either way must reach the same article.
const ARTICLE = {
  title: "信息科学与技术学院2026年第二十届院运会报名通知",
  contentSnippet:
    "✅ 参赛对象：信息科学与技术学院在校生\n✅ 比赛时间：2026年11月7日\n信息学院第二十届院运会燃情启幕。",
};

it("short and full college names resolve to the same subjects", () => {
  const short = buildQueryPlan("信息学院院运会");
  const full = buildQueryPlan("信息科学与技术学院院运会");
  expect(short.modifiers.map((m) => m.original)).toEqual([
    "信息学院",
    "院运会",
  ]);
  expect(full.modifiers.map((m) => m.original)).toEqual([
    "信息科学与技术学院",
    "院运会",
  ]);
  expect(short.modifiers[0].alternatives).toEqual([
    "信息科学与技术学院",
    "信息学院",
  ]);
  expect(full.modifiers[0].alternatives).toEqual(
    short.modifiers[0].alternatives,
  );
});

it("a full name is not split at its conjunction", () => {
  const plan = buildQueryPlan("信息科学与技术学院有没有院运会");
  expect(plan.modifiers.map((m) => m.original)).not.toContain("信息科学");
  expect(plan.modifiers.map((m) => m.original)).not.toContain("技术学院");
});

it("both spellings accept the article that uses the other one", () => {
  for (const query of ["信息学院院运会", "信息科学与技术学院院运会"]) {
    expect(queryRelevance(buildQueryPlan(query), ARTICLE).relevant).toBe(true);
  }
});

it("a short-name query does not require the cross-boundary bigram", () => {
  // "院院" only exists across the two words; requiring it matches nothing.
  const expression = ftsExpression("信息学院院运会")!;
  expect(expression).toContain('"h9662x8fd0"');
  expect(expression).not.toContain('"h9662x9662"');
});

it("the short name retrieves the notice that spells it out", async () => {
  const f = await dateGateFixture();
  try {
    f.sqlite
      .prepare(
        `INSERT INTO knowledge_documents(id,source_id,title,url,body,body_format,body_status,content_hash,fetched_at,campus_scope,data_domain,published_at,content_revision,input_hash,rights_scope,content_type,radar_category) VALUES(?,?,?,?,?,'plain','complete',?,'2026-10-10','all','campus_announcements',?,1,?,'licensed_full_text','notice','culture_sports')`,
      )
      .run(
        "informatics",
        f.source.id,
        "信息科学与技术学院2026年第二十届院运会报名通知",
        "https://example.invalid/informatics",
        "✅ 参赛对象：信息科学与技术学院在校生\n✅ 比赛时间：2026年11月7日\n信息学院第二十届院运会燃情启幕。",
        "informatics",
        "2026-10-27",
        "c".repeat(64),
      );
    await f.store.publishCollectedWebArticle("informatics");
    await ensureRetrievalIndex(f.db, "informatics");
    for (const query of ["信息学院院运会", "信息科学与技术学院院运会"]) {
      const r = await searchContent(
        f.db,
        "events",
        { query, limit: 3 },
        "2026-11-06T00:00:00Z",
      );
      expect(r.hits.map((h) => h.documentId)).toContain("informatics");
    }
  } finally {
    f.close();
  }
}, 15000);

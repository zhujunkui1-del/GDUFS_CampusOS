import { expect, it } from "vitest";
import { dateGateFixture } from "../fixtures/date-gate";
import { ensureRetrievalIndex } from "@/lib/server/retrieval/indexer";
import { searchContent } from "@/lib/server/retrieval/skills";
import { collegeRoundupIds } from "@/lib/server/retrieval/college-roundup";
import { ensureArticleAnalysis } from "@/lib/server/console/article-analysis";

async function add(
  f: Awaited<ReturnType<typeof dateGateFixture>>,
  id: string,
  title: string,
  body: string,
  date: string,
) {
  f.sqlite
    .prepare(
      `INSERT INTO knowledge_documents(id,source_id,title,url,body,body_format,body_status,content_hash,fetched_at,campus_scope,data_domain,published_at,content_revision,input_hash,rights_scope,content_type,radar_category) VALUES(?,?,?,?,?,'plain','complete',?,'2026-10-10','all','campus_announcements',?,1,?,'licensed_full_text','notice','culture_sports')`,
    )
    .run(
      id,
      f.source.id,
      title,
      "https://example.invalid/" + id,
      body,
      id,
      date,
      "c".repeat(64),
    );
  await f.store.publishCollectedWebArticle(id);
  // Publication does not derive the facets; the analysis pass does, and the
  // roundup reads the facets, so the fixture has to run it.
  await ensureArticleAnalysis(f.db, id);
  f.sqlite.prepare("DELETE FROM knowledge_chunks WHERE document_id=?").run(id);
  f.sqlite
    .prepare("DELETE FROM article_search_documents WHERE document_id=?")
    .run(id);
  await ensureRetrievalIndex(f.db, id);
}

it("groups an enumeration question by college instead of by chunk score", async () => {
  const f = await dateGateFixture();
  try {
    await add(
      f,
      "finance",
      "金融学院联合院运会预告",
      "院运会将于11月3日举行。",
      "2026-11-01",
    );
    await add(
      f,
      "english",
      "英语教育学院院运会预告",
      "院运会将于11月7日举行。",
      "2026-11-01",
    );
    await add(
      f,
      "accounting",
      "会计学院院运会回顾",
      "院运会已于11月1日举行。",
      "2026-11-02",
    );
    await add(
      f,
      "informatics",
      "信息科学与技术学院2026院运会报名通知",
      "✅ 比赛时间：2026年11月7日\n✅ 比赛地点：假草场\n报名进行中。",
      "2026-10-27",
    );
    // The facet query is what makes the fourth college reachable: it reads the
    // index by college, not by whichever chunk ranked highest.
    const ids = await collegeRoundupIds(f.db, "院运会", "2026-11-06T00:00:00Z");
    expect(ids).toContain("informatics");
    const r = await searchContent(
      f.db,
      "events",
      { query: "还有别的学院的院运会吗", limit: 5 },
      "2026-11-06T00:00:00Z",
    );
    expect(r.hits.map((h) => h.documentId)).toContain("informatics");
  } finally {
    f.close();
  }
}, 20000);

it("leaves a query that names one college alone", async () => {
  const f = await dateGateFixture();
  try {
    await add(
      f,
      "informatics",
      "信息科学与技术学院2026院运会报名通知",
      "✅ 比赛时间：2026年11月7日\n✅ 比赛地点：假草场",
      "2026-10-27",
    );
    // Asking about one college must not be answered with the other colleges.
    expect(
      await collegeRoundupIds(
        f.db,
        "信息学院有没有院运会",
        "2026-11-06T00:00:00Z",
      ),
    ).toEqual([]);
    expect(
      await collegeRoundupIds(
        f.db,
        "还有别的学院的院运会吗",
        "2026-11-06T00:00:00Z",
      ),
    ).toContain("informatics");
  } finally {
    f.close();
  }
}, 20000);

it("does not turn a subject query into a campus-wide roll call", async () => {
  const f = await dateGateFixture();
  try {
    await add(
      f,
      "informatics",
      "信息科学与技术学院人工智能讲座",
      "人工智能讲座将于11月7日举行。",
      "2026-11-01",
    );
    // "人工智能讲座" names a subject, so it is a lookup, not a roll call.
    expect(
      await collegeRoundupIds(f.db, "人工智能讲座", "2026-11-06T00:00:00Z"),
    ).toEqual([]);
    expect(
      await collegeRoundupIds(f.db, "有哪些讲座", "2026-11-06T00:00:00Z"),
    ).toContain("informatics");
  } finally {
    f.close();
  }
}, 20000);

it("ignores the roundup when the query carries a date filter", async () => {
  const f = await dateGateFixture();
  try {
    await add(
      f,
      "informatics",
      "信息科学与技术学院2026院运会报名通知",
      "✅ 比赛时间：2026年11月7日\n✅ 比赛地点：假草场",
      "2026-10-27",
    );
    // A narrower constraint (a date range) must win over enumeration breadth.
    const ids = await collegeRoundupIds(f.db, "院运会", "2026-11-06T00:00:00Z");
    expect(ids).toContain("informatics");
    const r = await searchContent(
      f.db,
      "events",
      { query: "院运会", after: "2027-01-01", before: "2027-01-20", limit: 5 },
      "2026-11-06T00:00:00Z",
    );
    expect(r.hits.map((h) => h.documentId)).not.toContain("informatics");
  } finally {
    f.close();
  }
}, 20000);

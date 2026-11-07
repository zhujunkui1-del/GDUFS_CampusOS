// The three acceptance conversations, written as facts rather than wording.
//
// The user's report was: "院运会" missed 信息学院, "还有别的学院的院运会吗"
// missed it again, and "信息学院有没有院运会" answered with a date that
// contradicted the article ("1月7日"). These cases pin the observable facts:
// which colleges are in the result, which day it says, and that one college
// never appears twice in one list.
import { expect, it } from "vitest";
import { dateGateFixture } from "../fixtures/date-gate";
import { ensureRetrievalIndex } from "@/lib/server/retrieval/indexer";
import { searchContent } from "@/lib/server/retrieval/skills";
import { collegeRoundupIds } from "@/lib/server/retrieval/college-roundup";
import { ensureArticleAnalysis } from "@/lib/server/console/article-analysis";
import { evidenceWindow } from "@/lib/retrieval/evidence-window";

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
  await ensureArticleAnalysis(f.db, id);
  f.sqlite.prepare("DELETE FROM knowledge_chunks WHERE document_id=?").run(id);
  f.sqlite
    .prepare("DELETE FROM article_search_documents WHERE document_id=?")
    .run(id);
  await ensureRetrievalIndex(f.db, id);
}

const INFORMATICS_BODY =
  "🌟 赛事基本信息\n" +
  "✅ 参赛对象：信息科学与技术学院在校生\n" +
  "✅ 比赛时间：2026年11月7日\n" +
  "✅ 比赛地点：假草场\n" +
  "秋意渐浓，11月7日，信息科学与技术学院第二十届院运会燃情启幕。";

async function seed() {
  const f = await dateGateFixture();
  await add(
    f,
    "finance",
    "金融学院联合院运会预告",
    "院运会将于10月25日举行。",
    "2026-10-25",
  );
  await add(
    f,
    "english",
    "英语教育学院第二十一届院运会预告",
    "院运会将于11月7日举行。",
    "2026-11-07",
  );
  await add(
    f,
    "accounting",
    "会计学院第十二届院运会回顾",
    "院运会已于11月1日举行。",
    "2026-11-01",
  );
  await add(
    f,
    "informatics",
    "信息科学与技术学院2026院运会报名通知",
    INFORMATICS_BODY,
    "2026-11-07",
  );
  return f;
}

it("round one: a bare activity noun still lists every college that has one", async () => {
  const f = await seed();
  try {
    const r = await searchContent(
      f.db,
      "events",
      { query: "院运会", limit: 5 },
      "2026-11-06T00:00:00Z",
    );
    const ids = r.hits.map((h) => h.documentId);
    expect(ids).toContain("informatics");
    expect(ids).toContain("finance");
    expect(ids).toContain("english");
  } finally {
    f.close();
  }
}, 20000);

it("round two: the follow-up still carries the college that was missing", async () => {
  const f = await seed();
  try {
    const r = await searchContent(
      f.db,
      "events",
      { query: "还有别的学院的院运会吗", limit: 5 },
      "2026-11-06T00:00:00Z",
    );
    expect(r.hits.map((h) => h.documentId)).toContain("informatics");
    // One row per college: a list of colleges must not repeat one of them.
    const ids = await collegeRoundupIds(
      f.db,
      "还有别的学院的院运会吗",
      "2026-11-06T00:00:00Z",
    );
    expect(new Set(ids).size).toBe(ids.length);
    const colleges = ids.map((id) => {
      const row = f.sqlite
        .prepare(
          "SELECT college FROM document_article_analysis WHERE document_id=?",
        )
        .get(id) as { college: string };
      return row.college;
    });
    expect(new Set(colleges).size).toBe(colleges.length);
  } finally {
    f.close();
  }
}, 20000);

it("round three: the date is the one the article states", async () => {
  const f = await seed();
  try {
    const r = await searchContent(
      f.db,
      "events",
      { query: "信息学院有没有院运会", limit: 5 },
      "2026-11-06T00:00:00Z",
    );
    expect(r.hits.map((h) => h.documentId)).toContain("informatics");
    const w = evidenceWindow(INFORMATICS_BODY, "信息学院有没有院运会", 220);
    expect(w.text).toContain("2026年11月7日");
    // A window may begin mid-line, but never inside a digit run: cutting
    // "2026年11月7日" at the second digit yields a false "1月7日".
    expect(w.text.slice(0, 4)).not.toBe("1月7日");
    expect(/^\d/.test(INFORMATICS_BODY.slice(w.start - 1, w.start))).toBe(
      false,
    );
  } finally {
    f.close();
  }
}, 20000);

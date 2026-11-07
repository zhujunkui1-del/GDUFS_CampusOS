import { expect, it } from "vitest";
import { dateGateFixture } from "../fixtures/date-gate";
import { ensureRetrievalIndex } from "@/lib/server/retrieval/indexer";
import { searchContent } from "@/lib/server/retrieval/skills";
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
  f.sqlite.prepare("DELETE FROM knowledge_chunks WHERE document_id=?").run(id);
  f.sqlite
    .prepare("DELETE FROM article_search_documents WHERE document_id=?")
    .run(id);
  await ensureRetrievalIndex(f.db, id);
}

it("a bare activity noun surfaces the notice that people can still act on", async () => {
  const f = await dateGateFixture();
  try {
    // Recaps of the same event type: real evidence, but they answer
    // "what happened", not "what is there / who can join".
    await add(
      f,
      "fin-joint",
      "预热 | 金融学院与社会与公共管理学院联合院运会",
      "院运会将于10月25日在大学城真草场举行。",
      "2026-10-20",
    );
    await add(
      f,
      "english",
      "英语教育学院第二十一届院运会预告",
      "院运会于11月7日在南校区真草场举行。",
      "2026-10-21",
    );
    await add(
      f,
      "accounting",
      "会计学院第十二届院运会回顾",
      "院运会已于11月1日举行，同学们奋勇争先。",
      "2026-11-02",
    );
    await add(
      f,
      "informatics",
      "信息科学与技术学院2026院运会报名通知",
      "✅ 比赛时间：2026年11月7日\n✅ 比赛地点：假草场\n信息科学与技术学院第二十届院运会报名进行中。",
      "2026-10-27",
    );
    const r = await searchContent(
      f.db,
      "events",
      { query: "院运会", limit: 3 },
      "2026-11-06T00:00:00Z",
    );
    expect(r.hits.map((h) => h.documentId)).toContain("informatics");
    expect(r.hits[0]?.documentId).toBe("informatics");
  } finally {
    f.close();
  }
}, 15000);

it("does not cut a window through the middle of a date", () => {
  const text =
    "🏃‍♂️ 青春展风采，运动向未来\n".repeat(20) +
    "✅ 参赛对象：信息科学与技术学院在校生\n" +
    "✅ 比赛时间：2026年11月7日\n" +
    "✅ 比赛地点：假草场\n" +
    "开幕式\n时间：2026 11.7 7:30-9:20\n" +
    "秋意渐浓，11月7日，信息学院第二十届院运会燃情启幕。";
  const w = evidenceWindow(text, "信息学院有没有院运会", 220);
  // The window may start mid-line, but never inside a date: a year split
  // across the cut reads as a different month ("1月7日").
  expect(w.text.slice(0, 4)).not.toBe("1月7日");
  expect(/^\d/.test(text.slice(w.start - 1, w.start))).toBe(false);
  expect(text.slice(w.start, w.start + w.text.length)).toBe(w.text);
});

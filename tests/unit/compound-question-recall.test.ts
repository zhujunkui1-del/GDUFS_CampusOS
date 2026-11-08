import { expect, it } from "vitest";
import { dateGateFixture } from "../fixtures/date-gate";
import { ensureRetrievalIndex } from "@/lib/server/retrieval/indexer";
import { searchContent } from "@/lib/server/retrieval/skills";
import { buildQueryPlan } from "@/lib/retrieval/query-plan";
import { ftsExpression } from "@/lib/retrieval/terms";

async function add(
  f: Awaited<ReturnType<typeof dateGateFixture>>,
  id: string,
  title: string,
  body: string,
) {
  f.sqlite
    .prepare(
      `INSERT INTO knowledge_documents(id,source_id,title,url,body,body_format,body_status,content_hash,fetched_at,campus_scope,data_domain,published_at,content_revision,input_hash,rights_scope,content_type,knowledge_category) VALUES(?,?,?,?,?,'plain','complete',?,'2026-10-10','all','campus_announcements','2026-09-01',1,?,'licensed_full_text','policy','campus_life')`,
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
  f.sqlite.prepare("DELETE FROM knowledge_chunks WHERE document_id=?").run(id);
  f.sqlite
    .prepare("DELETE FROM article_search_documents WHERE document_id=?")
    .run(id);
  await ensureRetrievalIndex(f.db, id);
}

it("a question that glues two nouns together still finds the rule that splits them", async () => {
  const f = await dateGateFixture();
  try {
    // The handbook says “门禁时间…” and “熄灯时间…” in separate sentences.
    // The question says “门禁熄灯”, which no article contains as one string.
    await add(
      f,
      "dorm-rule",
      "广东外语外贸大学学生宿舍管理规定（试行）",
      "第二十条 宿舍门禁时间为每日23时30分。\n第二十一条 学生宿舍熄灯时间为每日23时30分。",
    );
    const r = await searchContent(
      f.db,
      "knowledge",
      { query: "宿舍门禁熄灯是几点？", limit: 4 },
      "2026-11-06T00:00:00Z",
    );
    expect(r.hits.map((h) => h.documentId)).toContain("dorm-rule");
  } finally {
    f.close();
  }
}, 15000);

it("keeps the trailing verb out of a subject it would otherwise break", () => {
  for (const query of ["宿舍门禁熄灯是几点？", "缓考请假要走什么手续？"])
    for (const modifier of buildQueryPlan(query).modifiers)
      expect(modifier.original).not.toMatch(/[要走是]$/u);
});

it("still requires a topic that a plain college question names", () => {
  const expression = ftsExpression("信息学院院运会");
  expect(expression).toContain("h4fe1x606f");
  expect(expression).toContain("h9662x8fd0");
});

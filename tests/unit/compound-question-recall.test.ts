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

it("finds a rule whose two clauses landed in different chunks", async () => {
  const f = await dateGateFixture();
  try {
    // Real handbooks separate the curfew from the lights-out time by pages of
    // text, so the two words never share a 900-character chunk. Recall must
    // still reach the document and the subject check must look at the whole
    // document, not one paragraph.
    const filler =
      "第一条 学生应当遵守宿舍管理规定，爱护公共财物，保持室内整洁。\n".repeat(
        30,
      );
    await add(
      f,
      "dorm-split",
      "广东外语外贸大学学生宿舍管理规定（试行）",
      "第二十条 宿舍门禁时间为每日23时30分。\n" +
        filler +
        "第三十一条 学生宿舍熄灯时间为每日23时30分。",
    );
    const r = await searchContent(
      f.db,
      "knowledge",
      { query: "宿舍门禁熄灯是几点？", limit: 4 },
      "2026-11-06T00:00:00Z",
    );
    const hit = r.hits.find((h) => h.documentId === "dorm-split");
    expect(hit).toBeDefined();
    // The snippet is the citation. Half a rule reads like a wrong answer.
    expect(hit!.contentSnippet).toContain("门禁");
    expect(hit!.contentSnippet).toContain("熄灯");
  } finally {
    f.close();
  }
}, 15000);

it("ranks the document that the subject names, not a neighbour that shares a word", async () => {
  const f = await dateGateFixture();
  try {
    // "校历在哪看得到" is a phrase no article contains, so the old scoring
    // counted nothing and every candidate tied at the same two points; the
    // calendar itself then lost to a neighbour that merely said "管理办法".
    await f.sqlite
      .prepare(
        `INSERT INTO knowledge_documents(id,source_id,title,url,body,body_format,body_status,content_hash,fetched_at,campus_scope,data_domain,published_at,content_revision,input_hash,rights_scope,content_type,knowledge_category) VALUES(?,?,?,?,?,'plain','complete',?,'2026-10-10','all','campus_announcements','2026-09-01',1,?,'licensed_full_text','guide','academic_affairs')`,
      )
      .run(
        "cal",
        f.source.id,
        "2026-2027学年第一学期校历",
        "https://example.invalid/cal",
        "1．9月4、5日本科、研究生老生报到。9月6日本科新生报到。9月10、11日举行开学典礼。",
        "cal",
        "d".repeat(64),
      );
    await f.sqlite
      .prepare(
        `INSERT INTO knowledge_documents(id,source_id,title,url,body,body_format,body_status,content_hash,fetched_at,campus_scope,data_domain,published_at,content_revision,input_hash,rights_scope,content_type,knowledge_category) VALUES(?,?,?,?,?,'plain','complete',?,'2026-10-10','all','campus_announcements','2026-09-01',1,?,'licensed_full_text','policy','academic_affairs')`,
      )
      .run(
        "rule",
        f.source.id,
        "研究生教学管理办法实施细则",
        "https://example.invalid/rule",
        "校历见教务处网站。本办法由研究生院负责解释。",
        "rule",
        "e".repeat(64),
      );
    for (const id of ["cal", "rule"]) {
      await f.store.publishCollectedWebArticle(id);
      f.sqlite
        .prepare("DELETE FROM knowledge_chunks WHERE document_id=?")
        .run(id);
      f.sqlite
        .prepare("DELETE FROM article_search_documents WHERE document_id=?")
        .run(id);
      await ensureRetrievalIndex(f.db, id);
    }
    const r = await searchContent(f.db, "knowledge", {
      query: "校历在哪看得到，什么时候放假？",
      limit: 4,
    });
    expect(r.hits[0]?.documentId).toBe("cal");
  } finally {
    await f.close();
  }
});

it("finds a rule whose two words are stated in different chapters", async () => {
  const f = await dateGateFixture();
  try {
    // “缓考” is in chapter nine, “请假” is in chapter seven. The question glues
    // both into one subject, so no single chunk carries the whole phrase.
    const filler = "第五条 学生应当按时参加教学计划规定的一切活动。\n".repeat(
      40,
    );
    await add(
      f,
      "exam-handbook",
      "广东外语外贸大学本科生课程修读管理规定",
      `${filler}第七条 学生请假须经学院批准，报教务处备案。\n${filler}第九条 学生因病不能参加考试，可申请缓考，须在考试前提交书面申请。\n`,
    );
    const r = await searchContent(
      f.db,
      "knowledge",
      { query: "缓考请假要走什么手续？", limit: 4 },
      "2026-11-06T00:00:00Z",
    );
    expect(r.hits.map((h) => h.documentId)).toContain("exam-handbook");
  } finally {
    f.close();
  }
}, 15000);

it("still finds the chapter that the subject names", async () => {
  const f = await dateGateFixture();
  try {
    await add(
      f,
      "handbook",
      "2026年本科生学生手册（全文）",
      "第九章 缓考与补考\n第三十九条 学生因故不能参加考试的，可以申请缓考，办理缓考手续须在考前提交书面申请。",
    );
    await add(
      f,
      "notice",
      "2026年春季学期期末考试安排",
      "本次期末考试安排如下，请各位同学按时参加。",
    );
    const r = await searchContent(
      f.db,
      "knowledge",
      { query: "缓考请假要走什么手续？", limit: 4 },
      "2026-10-21T00:00:00Z",
    );
    expect(r.hits[0]?.documentId).toBe("handbook");
  } finally {
    await f.close();
  }
});

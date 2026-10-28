import { expect, it } from "vitest";
import { dateGateFixture } from "../fixtures/date-gate";
import { ensureRetrievalIndex } from "@/lib/server/retrieval/indexer";
import { searchContent } from "@/lib/server/retrieval/skills";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import { publicQuery } from "@/lib/server/assistant/read-plan";
import { ftsExpression, lexicalTokens } from "@/lib/retrieval/terms";
import { matchesQueryFocus } from "@/lib/retrieval/query-focus";
import {
  externalPolicy,
  supplementRequired,
} from "@/lib/server/external-search/policy";

it("the exact sports question retrieves sports notices rather than academic contests before the candidate limit", async () => {
  const f = await dateGateFixture();
  try {
    async function add(id: string, title: string, body: string) {
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
    }
    // Enough unrelated contests to exhaust the existing bounded FTS pool.
    for (let i = 0; i < 100; i++)
      await add(
        "academic-" + i,
        `第${i}届信息安全竞赛创新实践比赛大赛获奖`,
        "本届大赛学科竞赛比赛结束，我院学生获奖。" + i,
      );
    await add(
      "orienteering",
      "关于举办2026年新生杯定向越野比赛的通知",
      "定于2026年10月11日举办新生杯定向越野比赛。具体报名方法见附件。",
    );
    await add(
      "football",
      "关于举办2026年新生杯足球联赛的通知",
      "9月20日之后开始举行足球赛，请各学院踊跃报名。",
    );
    const input = contentIntent("广外有什么体育比赛可以参加吗");
    const result = await searchContent(
      f.db,
      "events",
      { query: input.query, limit: 3 },
      "2026-10-28T06:00:00Z",
    );
    expect(result.hits.map((h) => h.documentId)).toContain("orienteering");
    expect(result.hits.map((h) => h.documentId)).toContain("football");
    expect(result.hits.some((h) => /academic-/.test(h.documentId))).toBe(false);
    expect(result.metrics.candidateChunks).toBeLessThanOrEqual(96);
    expect(result.metrics.rowsWritten).toBe(0);
    expect(result.metrics.queries).toBeLessThanOrEqual(3);
    const plan = f.sqlite
      .prepare(
        "EXPLAIN QUERY PLAN SELECT rowid FROM article_chunk_fts WHERE article_chunk_fts MATCH ? ORDER BY rank LIMIT 96",
      )
      .all(ftsExpression(input.query));
    expect(plan.map((p) => p.detail).join(" ")).toMatch(/VIRTUAL TABLE INDEX/);
    const policy = externalPolicy(input.query);
    expect(policy.officialOnly).toBe(true);
    expect(policy.useXiaohongshu).toBe(false);
    // Past notices/unknown registration cannot prove a current opportunity.
    expect(supplementRequired(policy, [result])).toBe(true);
    // Explicit topic restrictions must also work without the word “体育”.
    const football = await searchContent(f.db, "events", {
      query: "广外有什么足球比赛",
      limit: 3,
    });
    expect(football.hits.map((h) => h.documentId)).toEqual(["football"]);
  } finally {
    f.close();
  }
}, 15000);

it.each(["体育比赛", "体育赛事", "运动会", "足球比赛", "羽毛球赛", "篮球赛"])(
  "retains the specific topic in indexed recall: %s",
  (topic) => {
    const expression = ftsExpression("广外有什么" + topic + "可以参加吗")!;
    expect(expression).not.toContain(lexicalTokens("大赛")[0]);
    expect(expression).toContain(
      lexicalTokens(/体育|运动会/.test(topic) ? "足球" : topic.slice(0, 2))[0],
    );
  },
);

it("does not accept an academic contest or a recruitment footer as sports evidence", () => {
  expect(
    matchesQueryFocus(
      "sports",
      { title: "投资分析大赛", contentSnippet: "各部门积极报名学科竞赛。" },
      "体育比赛",
    ),
  ).toBe(false);
  expect(
    matchesQueryFocus(
      "sports",
      {
        title: "社团招新",
        sourceName: "学院体育部",
        contentSnippet: "秘书部招新",
      },
      "体育比赛",
    ),
  ).toBe(false);
  expect(
    matchesQueryFocus(
      "sports",
      { title: "乒乓球比赛", contentSnippet: "欢迎报名" },
      "足球比赛",
    ),
  ).toBe(false);
  expect(publicQuery("广外有什么体育比赛可以参加吗")).toContain("体育比赛");
  expect(publicQuery("广外2026年大学城校区羽毛球比赛还能报名吗")).toBe(
    "广外 大学城校区 羽毛球 2026年 报名 通知",
  );
  expect(externalPolicy("只查内部广外体育比赛可以参加吗").active).toBe(false);
});

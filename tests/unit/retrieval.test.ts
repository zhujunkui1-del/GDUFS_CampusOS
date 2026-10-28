import { it, expect } from "vitest";
import { dateGateFixture, command } from "../fixtures/date-gate";
import { ensureRetrievalIndex } from "@/lib/server/retrieval/indexer";
import { D1KeywordRetriever } from "@/lib/server/retrieval/retriever";
import { PUBLIC_RETRIEVAL_SCOPE } from "@/domain/retrieval/contracts";
import { ftsExpression, lexicalTokens } from "@/lib/retrieval/terms";
async function article(
  f: Awaited<ReturnType<typeof dateGateFixture>>,
  body: string,
  id = "retrieval",
  metadata = false,
  url = "https://example.invalid/" + id,
  title = metadata ? "元数据专用图书馆借阅规则" : "真实片段测试",
) {
  f.sqlite
    .prepare(
      `INSERT INTO knowledge_documents(id,source_id,title,url,body,body_format,body_status,content_hash,fetched_at,campus_scope,data_domain,published_at,content_revision,input_hash,rights_scope,content_type,knowledge_category) VALUES(?,?,?,? ,?,'plain',?,'fixture-body','2026-10-25','all','campus_announcements','2026-10-24',1,?,?,'guide','campus_life')`,
    )
    .run(
      id,
      f.source.id,
      title,
      url,
      body,
      metadata ? "not_provided" : "complete",
      "c".repeat(64),
      metadata ? "metadata_only" : "licensed_full_text",
    );
  await f.store.publishCollectedWebArticle(id);
  f.sqlite.prepare("DELETE FROM knowledge_chunks WHERE document_id=?").run(id);
  f.sqlite
    .prepare("DELETE FROM article_search_documents WHERE document_id=?")
    .run(id);
}

it("encodes Chinese bigrams and keeps arbitrary query syntax out of MATCH", () => {
  expect(lexicalTokens("图书馆借阅")).toHaveLength(4);
  expect(ftsExpression('" OR * 借书')).not.toContain("*");
});
it("starts a directly matched procedural guide at its beginning instead of a keyword-heavy late step", async () => {
  const f = await dateGateFixture();
  try {
    await article(
      f,
      "第一步：打开就业系统，登录后申请电子协议。\n" +
        "操作说明与注意事项。".repeat(100) +
        "\n第七步：就业协议三方协议签约手续，确认就业协议申请信息。".repeat(12),
      "procedure",
      false,
      "https://example.invalid/procedure",
      "就业协议办理指南",
    );
    await ensureRetrievalIndex(f.db, "procedure");
    const r = await new D1KeywordRetriever(f.db).retrieve(
      { query: "就业协议怎么办理" },
      PUBLIC_RETRIEVAL_SCOPE,
    );
    expect(r.hits[0]?.contentSnippet).toContain("第一步");
  } finally {
    f.close();
  }
});
it("searches actual body chunks, uses authoritative gates, preserves HTML, and an unchanged index writes nothing", async () => {
  const f = await dateGateFixture();
  try {
    // A source article can remain unclassified; search never rewrites placement.
    await article(
      f,
      "图书馆借阅规则：读者可凭校园卡借书。续借请登录读者系统。",
    );
    const before = f.snapshot();
    expect((await ensureRetrievalIndex(f.db, "retrieval")).changed).toBe(true);
    expect(f.snapshot()).toBe(before);
    const writes = f.sqlite.prepare("SELECT total_changes() AS n").get()!.n;
    expect((await ensureRetrievalIndex(f.db, "retrieval")).changed).toBe(false);
    expect(f.sqlite.prepare("SELECT total_changes() AS n").get()!.n).toBe(
      writes,
    );
    const retriever = new D1KeywordRetriever(f.db);
    const r = await retriever.retrieve(
      { query: "广外图书馆怎么借书" },
      PUBLIC_RETRIEVAL_SCOPE,
    );
    expect(r.hits[0]).toMatchObject({
      documentId: "retrieval",
      bodyAvailable: true,
      evidenceBasis: "normalized_text",
    });
    expect(r.hits[0].contentSnippet).toContain("校园卡");
    expect(r.metrics.usageAvailable).toBe(false); // node:sqlite is not metered D1.
    expect(await retriever.revalidate(r.hits)).toBe(true);
    const d = await f.store.document("retrieval");
    await f.store.publish(
      d.id,
      { ...command(d.version), note: "下架测试" },
      true,
    );
    expect(await retriever.revalidate(r.hits)).toBe(false);
    expect(
      (
        await retriever.retrieve(
          { query: "图书馆借书" },
          PUBLIC_RETRIEVAL_SCOPE,
        )
      ).hits,
    ).toEqual([]);
  } finally {
    f.close();
  }
});
it("a stale version cannot leak body evidence", async () => {
  const f = await dateGateFixture();
  try {
    await article(f, "就业手续办理指南：提交就业协议书。");
    await ensureRetrievalIndex(f.db, "retrieval");
    const r = new D1KeywordRetriever(f.db);
    expect(
      (await r.retrieve({ query: "就业协议" }, PUBLIC_RETRIEVAL_SCOPE)).hits,
    ).toHaveLength(1);
    f.sqlite
      .prepare(
        "UPDATE knowledge_documents SET publication_status='draft',input_hash=? WHERE id='retrieval'",
      )
      .run("b".repeat(64));
    expect(
      (await r.retrieve({ query: "就业协议" }, PUBLIC_RETRIEVAL_SCOPE)).hits,
    ).toEqual([]);
  } finally {
    f.close();
  }
});
it("source body restrictions take effect without waiting for stale FTS removal", async () => {
  const f = await dateGateFixture();
  try {
    await article(f, "图书馆借阅规则：读者凭校园卡借书。");
    await ensureRetrievalIndex(f.db, "retrieval");
    const r = new D1KeywordRetriever(f.db),
      before = await r.retrieve(
        { query: "图书馆借书" },
        PUBLIC_RETRIEVAL_SCOPE,
      );
    expect(before.hits).toHaveLength(1);
    f.sqlite
      .prepare(
        "UPDATE knowledge_sources SET manual_policy_version=1,manual_rights_scope='metadata_only',manual_policy_expires_at_ms=? WHERE id=?",
      )
      .run(Date.now() + 86400000, f.source.id);
    expect(
      (await r.retrieve({ query: "图书馆借书" }, PUBLIC_RETRIEVAL_SCOPE)).hits,
    ).toEqual([]);
    expect(await r.revalidate(before.hits)).toBe(false);
  } finally {
    f.close();
  }
});
it("title-only articles return metadata, not invented body evidence", async () => {
  const f = await dateGateFixture();
  try {
    await article(f, "仅元数据", "retrieval", true);
    await ensureRetrievalIndex(f.db, "retrieval");
    const r = await new D1KeywordRetriever(f.db).retrieve(
      { query: "图书馆借阅规则" },
      PUBLIC_RETRIEVAL_SCOPE,
    );
    expect(r.hits[0]).toMatchObject({
      evidenceType: "metadata",
      bodyAvailable: false,
      evidenceBasis: "title",
    });
    expect(r.hits[0].contentSnippet).toBe("元数据专用图书馆借阅规则");
  } finally {
    f.close();
  }
});
it("recognizes a trusted official original without inventing a manual verification receipt", async () => {
  const f = await dateGateFixture();
  try {
    await article(
      f,
      "比赛时间：2026年10月31日。请新生参加羽毛球比赛。",
      "retrieval",
      false,
      "https://tyb.gdufs.edu.cn/info/fixture",
    );
    await ensureRetrievalIndex(f.db, "retrieval");
    const before = f.sqlite
      .prepare("SELECT official_status FROM knowledge_sources WHERE id=?")
      .get(f.source.id);
    const r = await new D1KeywordRetriever(f.db).retrieve(
      { query: "羽毛球比赛" },
      PUBLIC_RETRIEVAL_SCOPE,
    );
    expect(r.hits[0]?.official).toBe(true);
    expect(
      f.sqlite
        .prepare("SELECT official_status FROM knowledge_sources WHERE id=?")
        .get(f.source.id),
    ).toEqual(before);
  } finally {
    f.close();
  }
});
it("identical long article bodies deduplicate and retain the other public origin", async () => {
  const f = await dateGateFixture();
  try {
    const body =
      "图书馆借阅规则：读者凭校园卡借书，借阅图书后应按时归还。".repeat(12);
    await article(f, body);
    await article(f, body, "retrieval-copy");
    await ensureRetrievalIndex(f.db, "retrieval");
    await ensureRetrievalIndex(f.db, "retrieval-copy");
    const r = await new D1KeywordRetriever(f.db).retrieve(
      { query: "图书馆借阅规则" },
      PUBLIC_RETRIEVAL_SCOPE,
    );
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].linkedSources).toHaveLength(1);
  } finally {
    f.close();
  }
});

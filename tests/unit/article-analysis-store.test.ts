import { it, expect } from "vitest";
import { dateGateFixture, command } from "../fixtures/date-gate";
import {
  analysisStatements,
  ensureArticleAnalysis,
} from "@/lib/server/console/article-analysis";

it("reclassification changes only derived data, keeps identities HTML and publication; second ensure has zero writes", async () => {
  const f = await dateGateFixture();
  try {
    const before = f.snapshot();
    expect(await ensureArticleAnalysis(f.db, "spring")).toBe(true);
    expect(f.snapshot()).toBe(before);
    expect(f.visible()).toContain("spring");
    const n = f.sqlite.prepare("SELECT total_changes() AS n").get()!.n;
    expect(await ensureArticleAnalysis(f.db, "spring")).toBe(false);
    expect(f.sqlite.prepare("SELECT total_changes() AS n").get()!.n).toBe(n);
    expect(
      f.sqlite
        .prepare(
          "SELECT primary_destination FROM console_article_classifications WHERE document_id='spring'",
        )
        .get()!.primary_destination,
    ).toBe("unknown");
  } finally {
    f.close();
  }
});
it("manual placement overrides automatic reclassification and never releases a withdrawal", async () => {
  const f = await dateGateFixture();
  try {
    const d = await f.store.document("spring");
    await f.store.classifyArticlePlacement(d.id, {
      ...command(d.version),
      radarCategory: null,
      knowledgeCategory: "campus_life",
    });
    const after = await f.store.document(d.id);
    expect(after.inputHash).toBe(d.inputHash);
    expect(after.contentRevision).toBe(d.contentRevision);
    expect(after.publicationStatus).toBe("published");
    await f.store.publish(
      d.id,
      { ...command(after.version), note: "下架测试" },
      true,
    );
    await ensureArticleAnalysis(f.db, d.id);
    expect(f.visible()).not.toContain(d.id);
    expect(
      f.sqlite
        .prepare(
          "SELECT * FROM console_article_classifications WHERE document_id=?",
        )
        .get(d.id),
    ).toMatchObject({
      primary_destination: "knowledge",
      knowledge_category: "campus_life",
      classification_origin: "manual",
    });
  } finally {
    f.close();
  }
});
it("projection writes are fenced by source revision and cannot insert private evidence", async () => {
  const f = await dateGateFixture();
  try {
    const d = await f.store.document("spring");
    await f.db.batch(
      await analysisStatements(
        f.db,
        d.id,
        d.contentRevision + 1,
        d.inputHash!,
        { title: "不匹配的旧预测", body: "报名截止2026年11月3日。" },
      ),
    );
    expect(
      f.sqlite
        .prepare("SELECT count(*) n FROM document_article_analysis")
        .get()!.n,
    ).toBe(0);
    expect(
      f.sqlite.prepare("SELECT count(*) n FROM article_activity_index").get()!
        .n,
    ).toBe(0);
  } finally {
    f.close();
  }
});

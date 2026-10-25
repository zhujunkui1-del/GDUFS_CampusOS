import { describe, expect, it } from "vitest";
import {
  consoleV2Fixture,
  sourceInput,
  confirmed,
} from "../fixtures/console-v2";
import { ConsoleSyncStore } from "@/lib/server/console/v2-sync";
import { classifyArticle } from "@/domain/console/article-classification";
import { readPublicContent } from "@/lib/server/console/public-content";
const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
async function setup() {
  const f = await consoleV2Fixture(),
    store = new ConsoleSyncStore(f.db, f.actor);
  const s = await store.createGovernedSource(
    sourceInput({ governance: confirmed }),
  );
  async function add(title: string, originalChecked = true) {
    const source = await store.source(s.id);
    const r = await store.importBatch({
      commandId: crypto.randomUUID(),
      sourceId: s.id,
      sourceVersion: source.version,
      items: [
        {
          title,
          url: "https://example.invalid/" + crypto.randomUUID(),
          publishedAt: "2026-10-19",
          contentType: "notice",
          campusScope: "all",
          bodyStatus: "not_provided",
          originalChecked,
        },
      ],
    });
    return store.document(r.items[0].id);
  }
  return { ...f, store, s, add };
}
describe("exclusive article placement and captured metadata publication", () => {
  it("classifies standing services and dated opportunities separately", () => {
    expect(
      classifyArticle("关于图书馆学习空间分批次开放预约使用的通知"),
    ).toEqual({ radarCategory: null, knowledgeCategory: null });
    expect(
      classifyArticle({
        title: "2026学年助学金拟资助名单公示",
        body: "现将本年度助学金拟资助名单公示，请同学核对。",
      }),
    ).toEqual({
      radarCategory: "scholarship_opportunity",
      knowledgeCategory: null,
    });
    expect(
      classifyArticle({
        title: "关于举办云山学术沙龙413期讲座的通知",
        body: "讲座时间：2026年11月5日，欢迎师生参加。",
      }),
    ).toEqual({
      radarCategory: "lecture",
      knowledgeCategory: null,
    });
  });
  it("publishes captured metadata without an extra source auto-policy and keeps unknown original evidence private", async () => {
    const f = await setup();
    try {
      const a = await f.add("讲座报名通知"),
        b = await f.add("未核对的公告", false);
      expect(a.publicationStatus).toBe("published");
      expect(b.publicationStatus).toBe("draft");
      const radar = await readPublicContent(f.db, { surface: "radar" });
      expect(radar.items.map((r) => r.id)).toEqual([a.id]);
      expect(radar.items[0]).not.toHaveProperty("body");
      expect(
        f.sqlite.prepare("SELECT count(*) n FROM campus_events").get()?.n,
      ).toBe(0);
      expect(
        (await readPublicContent(f.db, { surface: "knowledge" })).total,
      ).toBe(0);
      expect(
        f.sqlite
          .prepare("SELECT count(*) n FROM console_publication_policies")
          .get()?.n,
      ).toBe(0);
    } finally {
      f.close();
    }
  });
  it("moves published articles atomically with history, preserves original facts, and never clears withdrawal/rejection holds", async () => {
    const f = await setup();
    try {
      const d = await f.add("办理服务通知");
      await f.store.classifyArticlePlacement(d.id, {
        ...cmd(d.version),
        radarCategory: null,
        knowledgeCategory: "administrative_services",
      });
      const current = await f.store.document(d.id);
      expect(current).toMatchObject({
        title: d.title,
        url: d.url,
        body: d.body,
        publishedAt: d.publishedAt,
        sourceId: d.sourceId,
        publicationStatus: "published",
        radarCategory: null,
      });
      expect((await f.store.version(d.id, d.version)).input.radarCategory).toBe(
        "campus_notice",
      );
      expect((await readPublicContent(f.db, { surface: "radar" })).total).toBe(
        0,
      );
      expect(
        (await readPublicContent(f.db, { surface: "knowledge" })).total,
      ).toBe(1);
      await f.store.publish(d.id, cmd(current.version), true);
      const withdrawn = await f.store.document(d.id);
      await f.store.classifyArticlePlacement(d.id, {
        ...cmd(withdrawn.version),
        radarCategory: "campus_notice",
        knowledgeCategory: null,
      });
      expect((await f.store.document(d.id)).publicationStatus).toBe(
        "withdrawn",
      );
      expect((await readPublicContent(f.db, { surface: "radar" })).total).toBe(
        0,
      );
      await expect(
        f.store.classifyArticlePlacement(d.id, {
          ...cmd(withdrawn.version),
          radarCategory: "lecture",
          knowledgeCategory: null,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const other = await f.add("需要人工退回的通知");
      await f.store.review(other.id, {
        ...cmd(other.version),
        decision: "rejected",
      });
      const rejected = await f.store.document(other.id);
      await f.store.classifyArticlePlacement(other.id, {
        ...cmd(rejected.version),
        radarCategory: null,
        knowledgeCategory: "campus_life",
      });
      expect((await f.store.document(other.id)).reviewStatus).toBe("rejected");
      expect(
        (await readPublicContent(f.db, { surface: "knowledge" })).total,
      ).toBe(0);
      expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      f.close();
    }
  });
  it("returns real category facets under search independently of the selected category", async () => {
    const f = await setup();
    try {
      await f.add("检索讲座");
      await f.add("检索比赛");
      await f.add("其他公告");
      const r = await readPublicContent(f.db, {
        surface: "radar",
        q: "检索",
        category: "lecture",
        limit: 1,
      });
      expect(r.items).toHaveLength(1);
      expect(r.total).toBe(2);
      expect(r.counts).toEqual({ lecture: 1, competition: 1 });
      const empty = await readPublicContent(f.db, {
        surface: "radar",
        source: "不存在",
      });
      expect(empty.total).toBe(0);
      expect(empty.counts).toEqual({});
      expect((await f.store.articlesV2({ review: "approved" })).total).toBe(3);
      await f.add("未批准的公告", false);
      expect((await f.store.articlesV2({ review: "unapproved" })).total).toBe(
        1,
      );
      expect(
        await f.store.syncNow({ commandId: crypto.randomUUID() }),
      ).toMatchObject({ state: "no_eligible_due_source", registered: 0 });
    } finally {
      f.close();
    }
  });
});

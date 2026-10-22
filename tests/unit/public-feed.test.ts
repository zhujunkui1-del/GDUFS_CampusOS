import { describe, it, expect } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { ManualImportStore } from "@/lib/server/console/manual-store";
import { readPublicContent } from "@/lib/server/console/public-content";
import { OfficialWebConnector } from "@/lib/ingestion/connector";
import { webProfiles } from "@/lib/ingestion/profiles";
const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
async function setup() {
  const f = sqliteD1(),
    actor = {
      id: "public-feed-admin",
      email: "feed@example.invalid",
      role: "admin" as const,
    };
  f.sqlite
    .prepare("INSERT INTO console_admins(id,email,role) VALUES(?,?,'admin')")
    .run(actor.id, actor.email);
  const store = new ManualImportStore(f.db, actor);
  const s = await store.createSource({
    commandId: crypto.randomUUID(),
    displayName: "隔离图书馆",
    sourceType: "official_web",
    campusScope: "all",
    websiteUrl: "https://example.invalid/",
    wechatId: null,
    evidenceUrls: [],
    priority: 3,
    connectorType: "disabled",
    fetchPolicy: { mode: "disabled", maxRequests: 0 },
  });
  await store.verifySource(s.id, {
    ...cmd(1),
    status: "verified",
    officialStatus: "verified_official",
    permissionStatus: "approved",
    authorityConfirmed: true,
    note: "隔离元数据用途",
    evidenceUrls: ["https://example.invalid/"],
  });
  await store.enableSource(s.id, { ...cmd(2), enabled: true });
  async function add(
    title: string,
    date: string,
    publish = true,
    radar: string | null = "campus_notice",
  ) {
    const id = (
      await store.importBatch({
        commandId: crypto.randomUUID(),
        sourceId: s.id,
        sourceVersion: 3,
        items: [
          {
            title,
            url: "https://example.invalid/" + crypto.randomUUID(),
            publishedAt: date,
            contentType: "notice",
            knowledgeCategory: radar ? null : "campus_life",
            radarCategory: radar,
            campusScope: "all",
            bodyStatus: "not_provided",
          },
        ],
      })
    ).items[0].id;
    if (publish) {
      await store.review(id, { ...cmd(1), decision: "approved" });
      await store.publish(id, cmd(2));
    }
    return id;
  }
  return { ...f, store, source: s, add };
}
describe("public radar and knowledge read the same fresh authoritative documents", () => {
  it("orders by original publication date, pages with a bounded lookahead, and never returns body", async () => {
    const f = await setup();
    try {
      const newer = await f.add("新通知", "2026-10-19");
      await f.add("后导入的旧通知", "2025-01-01");
      await f.add("待审核通知", "2026-10-20", false);
      const result = await readPublicContent(f.db, {
        surface: "radar",
        limit: 1,
      });
      expect(result.items.map((x) => x.id)).toEqual([newer]);
      expect(result.hasMore).toBe(true);
      expect(result.items[0]).not.toHaveProperty("body");
      const grouped = await readPublicContent(f.db, {
        surface: "radar",
        limit: 1,
        grouped: "1",
      });
      expect(grouped.groups?.campus_notice?.map((x) => x.id)).toEqual([newer]);
      expect(grouped.total).toBe(2);
      expect(grouped.nextCursor).toBeNull();
      expect((await f.store.source(f.source.id)).lastSuccessAt).toBeTruthy();
      const next = await readPublicContent(f.db, {
        surface: "radar",
        limit: 1,
        offset: 1,
      });
      expect(next.items[0].title).toBe("后导入的旧通知");
      expect(next.hasMore).toBe(false);
    } finally {
      f.close();
    }
  });
  it("filters literal titles, visible sources and the frozen category for each page", async () => {
    const f = await setup();
    try {
      await f.add("100%办理指南", "2026-10-18", true, null);
      await f.add("普通通知", "2026-10-17");
      expect(
        (await readPublicContent(f.db, { surface: "radar" })).items,
      ).toHaveLength(1);
      expect(
        (await readPublicContent(f.db, { surface: "knowledge" })).items,
      ).toHaveLength(1);
      expect(
        (
          await readPublicContent(f.db, {
            surface: "knowledge",
            q: "%",
            source: "图书馆",
            category: "campus_life",
          })
        ).items,
      ).toHaveLength(1);
      expect(
        (
          await readPublicContent(f.db, {
            surface: "radar",
            source: "不存在来源",
          })
        ).items,
      ).toHaveLength(0);
      await expect(
        readPublicContent(f.db, { surface: "radar", category: "campus_life" }),
      ).rejects.toThrow();
    } finally {
      f.close();
    }
  });
  it("withdrawal and stopping a source invalidate both feeds and stale versions immediately", async () => {
    const f = await setup();
    try {
      const id = await f.add("公开通知", "2026-10-18");
      expect(
        (await readPublicContent(f.db, { surface: "radar" })).items,
      ).toHaveLength(1);
      await f.store.publish(id, cmd(3), true);
      for (const surface of ["radar", "knowledge"])
        expect((await readPublicContent(f.db, { surface })).items).toHaveLength(
          0,
        );
      await expect(
        readPublicContent(f.db, { id, version: 3 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await f.add("第二通知", "2026-10-17");
      await f.store.enableSource(f.source.id, { ...cmd(3), enabled: false });
      expect(
        (await readPublicContent(f.db, { surface: "knowledge" })).items,
      ).toHaveLength(0);
    } finally {
      f.close();
    }
  });
  it("sorts dated listing rows ahead of pinned older rows and parses the VSB body template variants", () => {
    const p = webProfiles[4],
      c = new OfficialWebConnector(p);
    const found = c.discover(
      `<ul><li><h2><a href='/info/1134/1.htm'>[置顶]旧通知</a></h2><p>长期适用的指南</p><span>2019年10月28日</span></li><li><h2><a href='/info/1134/2.htm'>近期通知</a></h2><p>材料</p><span>2026年10月19日</span></li></ul>`,
    );
    expect(found.urls).toEqual([
      p.origin + "/info/1134/2.htm",
      p.origin + "/info/1134/1.htm",
    ]);
    const n = webProfiles[1],
      parsed = new OfficialWebConnector(n).parse(
        `<html><head><title>模板变体通知${n.titleSuffix}</title></head><body><div class="contenthead"><p>发布时间：2026-10-19 14:08:20</p></div><div id="vsb_content_7"><div class="v_news_content">合法的隔离测试正文</div></div></body></html>`,
        n.origin + "/info/1056/123.htm",
      );
    expect(parsed.title).toBe("模板变体通知");
    expect(parsed.publishedAt).toBe("2026-10-19T06:08:20.000Z");
    expect(parsed.bodyText).toContain("隔离测试正文");
  });
});

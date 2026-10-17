import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { ConsoleStore, filterPublicContent } from "@/lib/server/console/store";
import { ContentInputSchema } from "@/domain/console/contracts";
import {
  radarCategories,
  knowledgeCategories,
} from "@/domain/console/taxonomy";

const actor = {
  id: "compat-admin",
  email: "compat@example.invalid",
  role: "admin" as const,
};
const command = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
async function setup() {
  const f = sqliteD1();
  f.sqlite
    .prepare("INSERT INTO console_admins(id,email,role) VALUES(?,?,'admin')")
    .run(actor.id, actor.email);
  let clock = "2026-10-17T01:00:00.000Z";
  const store = new ConsoleStore(f.db, actor, () => clock);
  const source = await store.createSource({
    commandId: crypto.randomUUID(),
    displayName: "隔离兼容来源",
    sourceType: "official_web",
    campusScope: "all",
    websiteUrl: "https://example.invalid/",
    wechatId: null,
    evidenceUrls: [],
    priority: 1,
    connectorType: "disabled",
    fetchPolicy: { mode: "disabled", maxRequests: 0 },
  });
  await store.verifySource(source.id, {
    ...command(1),
    status: "verified",
    officialStatus: "verified_official",
    permissionStatus: "approved",
    note: "隔离来源许可核验",
    evidenceUrls: ["https://example.invalid/terms"],
    authorityConfirmed: true,
  });
  await store.enableSource(source.id, { ...command(2), enabled: true });
  const input = ContentInputSchema.parse({
    sourceId: source.id,
    title: "2020年通知",
    body: "隔离测试内容",
    url: "https://example.invalid/old",
    kind: "knowledge",
    campusScope: "all",
    publishedAt: "2020-03-01T08:00:00+08:00",
    sourceUpdatedAt: "2020-03-02T08:00:00+08:00",
    validUntil: null,
    extractedFields: {},
    contentType: "notice",
    knowledgeCategory: "campus_life",
    rightsScope: "licensed_full_text",
  });
  const d = await store.writeContent(undefined, { ...input, ...command(0) });
  return {
    ...f,
    store,
    input,
    id: d.id,
    sourceId: source.id,
    tick: () => {
      clock = "2026-10-18T01:00:00.000Z";
    },
  };
}
describe("S3 content contract compatibility", () => {
  it("quarantines old application writes to a new approved revision on application rollback", async () => {
    const f = await setup();
    try {
      await f.store.review(f.id, {
        ...command(1),
        decision: "approved",
        note: "隔离审核",
      });
      await f.store.publish(f.id, { ...command(2), note: "隔离发布" });
      f.sqlite
        .prepare(
          "UPDATE knowledge_documents SET body='old application changed body',version=version+1,publication_status='draft' WHERE id=?",
        )
        .run(f.id);
      expect(
        f.sqlite
          .prepare(
            "SELECT content_revision,input_hash,approved_input_hash,review_status FROM knowledge_documents WHERE id=?",
          )
          .get(f.id),
      ).toMatchObject({
        content_revision: 2,
        input_hash: null,
        approved_input_hash: null,
        review_status: "pending",
      });
      f.sqlite
        .prepare(
          "UPDATE knowledge_documents SET review_status='approved',workflow_status='approved',version=version+1 WHERE id=?",
        )
        .run(f.id);
      expect(() =>
        f.sqlite
          .prepare(
            "UPDATE knowledge_documents SET publication_status='published' WHERE id=?",
          )
          .run(f.id),
      ).toThrow();
      expect(
        await filterPublicContent(f.db, [{ id: f.id, version: 5 }]),
      ).toEqual([]);
    } finally {
      f.close();
    }
  });
  it("keeps auxiliary topics separate from categories and restores their snapshot", async () => {
    const f = await setup();
    try {
      await f.store.writeContent(f.id, {
        ...f.input,
        tags: ["AI", "AI", "信息素养"],
        ...command(1),
      });
      expect(await f.store.document(f.id)).toMatchObject({
        tags: ["AI", "信息素养"],
      });
      await f.store.writeContent(f.id, {
        ...f.input,
        tags: ["志愿服务"],
        ...command(2),
      });
      await f.store.restore(f.id, { ...command(3), version: 2 });
      expect(await f.store.document(f.id)).toMatchObject({
        tags: ["AI", "信息素养"],
        reviewStatus: "pending",
      });
      expect(() =>
        ContentInputSchema.parse({ ...f.input, tags: ["大学城"] }),
      ).toThrow();
    } finally {
      f.close();
    }
  });
  it("preserves original publication/acquisition on edit and restore, separates system/source updates", async () => {
    const f = await setup();
    try {
      const first = await f.store.document(f.id);
      f.tick();
      await f.store.writeContent(f.id, {
        ...f.input,
        title: "修改标题",
        ...command(first.version),
      });
      const edit = await f.store.document(f.id);
      expect(edit.fetchedAt).toBe(first.fetchedAt);
      expect(edit.publishedAt).toBe("2020-03-01T00:00:00.000Z");
      expect(edit.sourceUpdatedAt).toBe("2020-03-02T00:00:00.000Z");
      expect(edit.updatedAt).not.toBe(first.updatedAt);
      expect(edit.contentRevision).toBe(2);
      expect(edit.inputHash).not.toBe(first.inputHash);
      await f.store.restore(f.id, { ...command(edit.version), version: 1 });
      const restored = await f.store.document(f.id);
      expect(restored.fetchedAt).toBe(first.fetchedAt);
      expect(restored.contentRevision).toBe(3);
      expect(restored.publicationStatus).toBe("draft");
    } finally {
      f.close();
    }
  });
  it("approval and publication increase business version without invalidating content evidence", async () => {
    const f = await setup();
    try {
      const before = await f.store.document(f.id);
      await f.store.review(f.id, {
        ...command(1),
        decision: "approved",
        note: "核对原文",
      });
      await f.store.publish(f.id, { ...command(2), note: "授权发布" });
      const after = await f.store.document(f.id);
      expect(after.version).toBe(3);
      expect(after.contentRevision).toBe(before.contentRevision);
      expect(after.inputHash).toBe(before.inputHash);
      expect(
        await filterPublicContent(f.db, [{ id: f.id, version: 3 }]),
      ).toHaveLength(1);
      expect(
        f.sqlite
          .prepare(
            "SELECT count(DISTINCT input_hash) AS n FROM console_content_versions WHERE document_id=?",
          )
          .get(f.id),
      ).toMatchObject({ n: 1 });
      await f.store.writeContent(f.id, {
        ...f.input,
        body: "修改后的内容",
        ...command(3),
      });
      expect(
        await filterPublicContent(f.db, [{ id: f.id, version: 3 }]),
      ).toEqual([]);
      expect(
        f.sqlite
          .prepare(
            "SELECT approved_input_hash AS hash FROM knowledge_documents WHERE id=?",
          )
          .get(f.id),
      ).toMatchObject({ hash: null });
    } finally {
      f.close();
    }
  });
  it("unknown rights and unknown category cannot publish; metadata does not grant RAG/fulltext", async () => {
    const f = await setup();
    try {
      await f.store.writeContent(f.id, {
        ...f.input,
        rightsScope: "unknown",
        ...command(1),
      });
      await f.store.review(f.id, {
        ...command(2),
        decision: "approved",
        note: "原文审核",
      });
      await expect(
        f.store.publish(f.id, { ...command(3), note: "试图发布" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await f.store.writeContent(f.id, {
        ...f.input,
        rightsScope: "metadata_only",
        ...command(3),
      });
      await f.store.review(f.id, {
        ...command(4),
        decision: "approved",
        note: "元数据审核",
      });
      await f.store.publish(f.id, { ...command(5), note: "元数据发布" });
      expect(
        await filterPublicContent(f.db, [{ id: f.id, version: 6 }], "metadata"),
      ).toHaveLength(1);
      expect(
        await filterPublicContent(f.db, [{ id: f.id, version: 6 }]),
      ).toEqual([]);
      expect(
        await filterPublicContent(
          f.db,
          [{ id: f.id, version: 6 }],
          "full_text",
        ),
      ).toEqual([]);
      await f.store.writeContent(f.id, {
        ...f.input,
        knowledgeCategory: null,
        ...command(6),
      });
      await f.store.review(f.id, {
        ...command(7),
        decision: "approved",
        note: "分类未确定",
      });
      await expect(
        f.store.publish(f.id, { ...command(8), note: "不应发布" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    } finally {
      f.close();
    }
  });
  it("keeps source pause and expired/withdrawn documents out of every public purpose", async () => {
    const f = await setup();
    try {
      await f.store.review(f.id, {
        ...command(1),
        decision: "approved",
        note: "真实审核",
      });
      await f.store.publish(f.id, { ...command(2), note: "真实发布" });
      await f.store.enableSource(f.sourceId, { ...command(3), enabled: false });
      expect(
        await filterPublicContent(f.db, [{ id: f.id, version: 3 }], "metadata"),
      ).toEqual([]);
      expect(
        f.sqlite
          .prepare(
            "SELECT count(*) AS n FROM content_index_invalidations WHERE reason='source_policy_changed'",
          )
          .get(),
      ).toMatchObject({ n: expect.any(Number) });
    } finally {
      f.close();
    }
  });
  it("SQL categories match the frozen JSON and reject arbitrary names", async () => {
    const f = await setup();
    try {
      for (const c of knowledgeCategories)
        expect(() =>
          f.sqlite
            .prepare(
              "UPDATE knowledge_documents SET knowledge_category=? WHERE id=?",
            )
            .run(c.code, f.id),
        ).not.toThrow();
      for (const c of radarCategories)
        expect(() =>
          f.sqlite
            .prepare(
              "UPDATE knowledge_documents SET radar_category=? WHERE id=?",
            )
            .run(c.code, f.id),
        ).not.toThrow();
      expect(() =>
        f.sqlite
          .prepare(
            "UPDATE knowledge_documents SET knowledge_category='食堂' WHERE id=?",
          )
          .run(f.id),
      ).toThrow();
      expect(() =>
        ContentInputSchema.parse({ ...f.input, knowledgeCategory: "食堂" }),
      ).toThrow();
    } finally {
      f.close();
    }
  });
  it("replays empty and populated upgrade without changing legacy statuses, snapshots or private content", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys=ON");
      for (const file of readdirSync("migrations")
        .filter((x) => x.endsWith(".sql") && x < "0007")
        .sort())
        db.exec(readFileSync("migrations/" + file, "utf8"));
      db.exec(
        "INSERT INTO knowledge_sources(id,display_name,source_type,allowed_domains_json,entry_urls_json,fetch_policy_json,console_managed,verification_status) VALUES('legacy','legacy','official_web','[]','[]','{}',1,'verified'); INSERT INTO knowledge_documents(id,source_id,title,url,body,content_hash,fetched_at,published_at,campus_scope,data_domain,review_status) VALUES('legacy','legacy','legacy','https://example.invalid/legacy','legacy','legacy','2020-01-01T00:00:00Z','2019-01-01T00:00:00Z','all','official_policy','approved'); INSERT INTO console_content_versions(document_id,version,snapshot_json,created_at) VALUES('legacy',1,'{\"input\":{}}','2020-01-01');",
      );
      db.exec(readFileSync("migrations/0007_content_contract.sql", "utf8"));
      expect(
        db
          .prepare(
            "SELECT published_at,fetched_at,review_status,content_revision,input_hash FROM knowledge_documents",
          )
          .get(),
      ).toMatchObject({
        published_at: "2019-01-01T00:00:00Z",
        fetched_at: "2020-01-01T00:00:00Z",
        review_status: "approved",
        content_revision: 0,
        input_hash: null,
      });
      expect(
        db.prepare("SELECT snapshot_json FROM console_content_versions").get(),
      ).toMatchObject({ snapshot_json: '{"input":{}}' });
      expect(
        db.prepare("SELECT verification_status FROM knowledge_sources").get(),
      ).toMatchObject({ verification_status: "verified" });
      expect(
        db.prepare("SELECT count(*) AS n FROM console_public_documents").get(),
      ).toMatchObject({ n: 0 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(() =>
        db.exec(
          "BEGIN; UPDATE knowledge_documents SET title='must rollback'; INSERT INTO knowledge_documents SELECT * FROM knowledge_documents;",
        ),
      ).toThrow();
      db.exec("ROLLBACK");
      expect(
        db.prepare("SELECT title FROM knowledge_documents").get(),
      ).toMatchObject({ title: "legacy" });
      // Old-version shaped writes still work as drafts, but cannot gain public visibility.
      expect(() =>
        db.exec(
          "UPDATE knowledge_documents SET title='old client draft',version=version+1",
        ),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });
});

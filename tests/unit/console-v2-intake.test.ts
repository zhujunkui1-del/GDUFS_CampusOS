import { it, expect, describe } from "vitest";
import {
  consoleV2Fixture,
  sourceInput,
  confirmed,
} from "../fixtures/console-v2";
import { ConsoleSyncStore } from "@/lib/server/console/v2-sync";
import { canonicalArticleUrl } from "@/lib/ingestion/canonical-url";
const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
async function setup() {
  const f = await consoleV2Fixture(),
    store = new ConsoleSyncStore(f.db, f.actor);
  async function source(name: string) {
    const s = await store.createGovernedSource(
      sourceInput({
        displayName: name,
        websiteUrl: "https://example.invalid/" + name,
        governance: confirmed,
      }),
    );
    await store.verifySource(s.id, {
      ...cmd(1),
      status: "verified",
      officialStatus: "verified_official",
      permissionStatus: "approved",
      authorityConfirmed: true,
      evidenceUrls: ["https://example.invalid/license"],
      note: "隔离来源主体与元数据许可",
    });
    await store.setImportPolicy(s.id, {
      ...cmd(2),
      rightsScope: "metadata_only",
      evidenceUrls: ["https://example.invalid/license"],
      note: "隔离来源的元数据导入许可",
    });
    return s.id;
  }
  const item = {
    title: "同一篇隔离通知",
    url: "https://example.invalid/article?utm_source=test#rd",
    publishedAt: "2020-01-01",
    knowledgeCategory: "campus_life",
    contentType: "notice",
    campusScope: "all",
    originalChecked: true,
  };
  const batch = (sourceId: string, extra: object = {}) => ({
    commandId: crypto.randomUUID(),
    sourceId,
    sourceVersion: 3,
    items: [{ ...item, ...extra }],
  });
  return { ...f, store, source, item, batch };
}
describe("V2 canonical intake and multiple discovery origins", () => {
  it("retains tracking-free identity without removing WeChat identity parameters", () => {
    expect(
      canonicalArticleUrl(
        "https://mp.weixin.qq.com/s?mid=1&__biz=real&idx=2&sn=signature&scene=3#rd",
      ),
    ).toBe("https://mp.weixin.qq.com/s?__biz=real&idx=2&mid=1&sn=signature");
  });
  it("keeps non-WeChat identity-like from/scene parameters", () => {
    expect(
      canonicalArticleUrl(
        "https://example.invalid/a?from=2020&scene=department",
      ),
    ).toBe("https://example.invalid/a?from=2020&scene=department");
  });
  it("reuses an exact canonical document, preserves both sources, human context and whitelist protection", async () => {
    const f = await setup();
    try {
      const a = await f.source("A"),
        b = await f.source("B"),
        first = await f.store.importBatch(f.batch(a)),
        id = first.items[0].id,
        old = await f.store.document(id);
      const shared = await f.store.importBatch(
        f.batch(b, { url: "https://example.invalid/article" }),
      );
      expect(shared).toMatchObject({ linked: [id] });
      expect(shared.items[0].id).toBe(id);
      expect(
        f.sqlite.prepare("SELECT count(*) n FROM knowledge_documents").get()?.n,
      ).toBe(1);
      expect(
        f.sqlite.prepare("SELECT count(*) n FROM document_origins").get()?.n,
      ).toBe(2);
      expect((await f.store.document(id)).version).toBe(old.version);
      expect(
        f.sqlite
          .prepare("SELECT count(*) n FROM console_content_attestations")
          .get()?.n,
      ).toBe(1);
      expect((await f.store.articlesV2({ sourceId: b })).total).toBe(1);
      await f.store.protection({
        ...cmd(3),
        type: "source",
        targetId: b,
        active: true,
        historyExempt: false,
        expiresAt: null,
        reason: "保护含多个发现出处的重要资料",
      });
      expect(
        (await f.store.articlesV2({ sourceId: a, protected: "1" })).total,
      ).toBe(1);
      await f.store.protection({
        ...cmd(4),
        type: "source",
        targetId: b,
        active: false,
        historyExempt: false,
        expiresAt: null,
        reason: "解除隔离来源的保留保护",
      });
      await f.store.archiveSource(b, cmd(5));
      expect((await f.store.document(id)).sourceId).toBe(a);
      expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      f.close();
    }
  });
  it("enforces cutoff on a new origin, permits explicit history exemption and continues existing valid-source maintenance", async () => {
    const f = await setup();
    try {
      const a = await f.source("A"),
        b = await f.source("B"),
        first = await f.store.importBatch(f.batch(a)),
        id = first.items[0].id;
      await f.store.saveEngineSettings({
        ...cmd(1),
        syncHours: 24,
        autoSync: true,
        networkBudget: 20,
        earliestImportDay: "2025-09-01",
        confirmImportCutoff: true,
        note: "明确批准新的导入截止规则",
      });
      await expect(f.store.importBatch(f.batch(b))).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
      expect(
        f.sqlite.prepare("SELECT count(*) n FROM document_origins").get()?.n,
      ).toBe(1);
      await f.store.importBatch(
        f.batch(a, {
          summary: "现存有效资料的人工修正",
          ownNoteConfirmed: true,
          expectedVersion: (await f.store.document(id)).version,
        }),
      );
      expect((await f.store.document(id)).summary).toBe(
        "现存有效资料的人工修正",
      );
      await f.store.protection({
        ...cmd(3),
        type: "source",
        targetId: b,
        active: true,
        historyExempt: true,
        expiresAt: null,
        reason: "明确批准长期有效资料的历史导入",
      });
      const linked = await f.store.importBatch({
        ...f.batch(b),
        sourceVersion: 4,
      });
      expect(linked.items[0].id).toBe(id);
      expect((await f.store.document(id)).summary).toBe(
        "现存有效资料的人工修正",
      );
    } finally {
      f.close();
    }
  });
  it("does not let an operator take another source's document by changing sourceId", async () => {
    const f = await setup();
    try {
      const a = await f.source("A"),
        b = await f.source("B"),
        r = await f.store.importBatch(f.batch(a)),
        id = r.items[0].id;
      f.sqlite.exec(
        "INSERT INTO console_admins(id,email,role) VALUES('ops','ops@example.invalid','operator')",
      );
      await f.store.assignOperator(b, {
        ...cmd(3),
        operatorId: "ops",
        enabled: true,
      });
      const ops = new ConsoleSyncStore(f.db, {
          id: "ops",
          email: "ops@example.invalid",
          role: "operator",
        }),
        input = (await f.store.version(id, 1)).input;
      await expect(
        ops.writeContent(id, { ...input, ...cmd(1), sourceId: b }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await f.store.document(id)).sourceId).toBe(a);
    } finally {
      f.close();
    }
  });
});

import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { ConsoleStore } from "@/lib/server/console/store";
import { ConsoleGovernanceStore } from "@/lib/server/console/v2-governance";

const admin = {
  id: "test-admin",
  email: "test-admin@example.invalid",
  role: "admin" as const,
};
const operator = {
  id: "test-operator",
  email: "test-operator@example.invalid",
  role: "operator" as const,
};
const input = {
  displayName: "隔离测试来源",
  sourceAliases: [],
  sourceType: "official_web",
  subtype: "测试",
  organization: "隔离测试",
  campusScope: "all",
  websiteUrl: "https://example.invalid/source",
  wechatId: null,
  evidenceUrls: ["https://example.invalid/proof"],
  priority: 1,
  connectorType: "disabled",
  connectorConfig: {},
  fetchPolicy: { mode: "disabled", maxRequests: 0 },
};
describe("Console content deletion", () => {
  let fixture: ReturnType<typeof sqliteD1>, store: ConsoleStore;
  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite
      .prepare("INSERT INTO console_admins(id,email,role) VALUES(?,?,'admin')")
      .run(admin.id, admin.email);
    fixture.sqlite
      .prepare(
        "INSERT INTO console_admins(id,email,role) VALUES(?,?,'operator')",
      )
      .run(operator.id, operator.email);
    store = new ConsoleStore(fixture.db, admin);
  });
  afterEach(() => fixture.close());
  async function readySource(target = store) {
    const id = (
      await target.createSource({
        ...input,
        websiteUrl: input.websiteUrl + "/" + crypto.randomUUID(),
        commandId: crypto.randomUUID(),
      })
    ).id;
    let s = await target.source(id);
    await target.verifySource(id, {
      commandId: crypto.randomUUID(),
      expectedVersion: s.version,
      status: "verified",
      officialStatus: "verified_official",
      permissionStatus: "approved",
      note: "隔离测试：人工核对归属及许可",
      evidenceUrls: input.evidenceUrls,
      authorityConfirmed: true,
    });
    s = await target.source(id);
    await target.enableSource(id, {
      commandId: crypto.randomUUID(),
      expectedVersion: s.version,
      enabled: true,
    });
    return id;
  }
  async function article(
    sourceId: string,
    bodyFormat?: "plain" | "reading_html",
  ) {
    return (
      await store.writeContent(undefined, {
        sourceId,
        title: "隔离测试文章",
        body: "未采集的隔离测试夹具",
        ...(bodyFormat ? { bodyFormat } : {}),
        url: "https://example.invalid/article",
        kind: "knowledge",
        contentType: "guide",
        rightsScope: "licensed_full_text",
        knowledgeCategory: "campus_life",
        campusScope: "all",
        validUntil: null,
        publishedAt: null,
        extractedFields: {},
        commandId: crypto.randomUUID(),
        expectedVersion: 0,
      })
    ).id;
  }
  it("removes a manual article from the list, the detail view and the command trail", async () => {
    const id = await article(await readySource());
    const governance = new ConsoleGovernanceStore(fixture.db, admin);
    expect((await store.content({})).total).toBe(1);
    expect((await governance.articlesV2({})).total).toBe(1);
    await expect(
      store.deleteContent(id, {
        commandId: crypto.randomUUID(),
        expectedVersion: 1,
      }),
    ).resolves.toMatchObject({ id, version: 2, idempotent: false });
    expect((await store.content({})).total).toBe(0);
    expect((await governance.articlesV2({})).total).toBe(0);
    expect((await store.content({ status: "withdrawn" })).total).toBe(0);
    await expect(store.document(id)).rejects.toThrow("未找到该内容。");
    expect(
      fixture.sqlite
        .prepare(
          "SELECT publication_status,lifecycle_status,deleted_at FROM knowledge_documents WHERE id=?",
        )
        .get(id),
    ).toMatchObject({
      publication_status: "withdrawn",
      lifecycle_status: "withdrawn",
    });
    expect(
      fixture.sqlite
        .prepare("SELECT deleted_at FROM knowledge_documents WHERE id=?")
        .get(id),
    ).toMatchObject({ deleted_at: expect.any(String) });
    expect(
      fixture.sqlite
        .prepare("SELECT action FROM console_commands WHERE target_id=?")
        .all(id),
    ).toEqual([{ action: "document.create" }, { action: "document.delete" }]);
    expect(
      fixture.sqlite
        .prepare(
          "SELECT hold_reason FROM console_document_controls WHERE document_id=?",
        )
        .get(id),
    ).toMatchObject({ hold_reason: "manual_withdrawal" });
    expect(
      fixture.sqlite
        .prepare(
          "SELECT count(*) AS n FROM console_content_versions WHERE document_id=?",
        )
        .get(id),
      // 创建与删除各留一份版本快照，删除记录不会抹掉历史。
    ).toMatchObject({ n: 2 });
  });
  it("requires the publish permission that only administrators hold", async () => {
    const id = await article(await readySource());
    const operatorStore = new ConsoleStore(fixture.db, operator);
    await expect(
      operatorStore.deleteContent(id, {
        commandId: crypto.randomUUID(),
        expectedVersion: 1,
      }),
    ).rejects.toThrow("没有执行此操作的管理权限。");
    expect((await store.content({})).total).toBe(1);
  });
  it("refuses an article the collector maintains", async () => {
    const id = await article(await readySource(), "reading_html");
    await expect(
      store.deleteContent(id, {
        commandId: crypto.randomUUID(),
        expectedVersion: 1,
      }),
    ).rejects.toThrow("此文章由采集程序维护，请在采集设置中停止同步。");
    expect((await store.content({})).total).toBe(1);
  });
});

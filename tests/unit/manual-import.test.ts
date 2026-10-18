import { describe, it, expect } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { ManualImportStore } from "@/lib/server/console/manual-store";
import { readPublicContent } from "@/lib/server/console/public-content";
import { filterPublicContent } from "@/lib/server/console/store";
import { ManualImportSchema } from "@/domain/console/manual-import";
import { parseCampusTime } from "@/lib/ingestion/time";
const actor = {
  id: "manual-test-admin",
  email: "manual@example.invalid",
  role: "admin" as const,
};
const command = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
async function setup(
  rights:
    | "metadata_only"
    | "excerpt_and_link"
    | "licensed_full_text" = "metadata_only",
) {
  const f = sqliteD1();
  f.sqlite
    .prepare("INSERT INTO console_admins(id,email,role) VALUES(?,?,'admin')")
    .run(actor.id, actor.email);
  const store = new ManualImportStore(f.db, actor);
  const source = await store.createSource({
    commandId: crypto.randomUUID(),
    displayName: "隔离人工来源",
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
    authorityConfirmed: true,
    note: "隔离许可证明",
    evidenceUrls: ["https://example.invalid/license"],
  });
  await store.enableSource(source.id, { ...command(2), enabled: true });
  await store.setImportPolicy(source.id, {
    ...command(3),
    rightsScope: rights,
    evidenceUrls: ["https://example.invalid/license"],
    note: "隔离许可核验记录",
    fullTextAuthorized: rights !== "metadata_only",
  });
  const item = {
    title: "隔离2020年通知",
    url: "https://example.invalid/2020/article",
    publishedAt: "2020-01-02",
    campusScope: "all",
    contentType: "notice",
    knowledgeCategory: "campus_life",
    bodyStatus: "not_provided",
    discoveryUrls: [
      "https://example.invalid/list-one",
      "https://example.invalid/list-two",
    ],
  };
  const batch = (items = [item]) => ({
    commandId: crypto.randomUUID(),
    sourceId: source.id,
    sourceVersion: 4,
    items,
  });
  return { ...f, store, source, item, batch };
}
describe("bounded manual intake and fresh anonymous metadata", () => {
  it("atomically imports metadata, separate timestamps, all discovery observations and real receipts", async () => {
    const f = await setup();
    try {
      const raw = f.batch(),
        imported = await f.store.importBatch(raw),
        id = imported.items[0].id;
      expect(imported.items[0].outcome).toBe("created");
      const d = await f.store.document(id);
      expect(d).toMatchObject({
        publishedAt: "2020-01-02",
        bodyStatus: "not_provided",
        reviewStatus: "pending",
        publicationStatus: "draft",
      });
      expect(d.fetchedAt).not.toContain("2020-01-02");
      expect(
        f.sqlite.prepare("SELECT * FROM document_discoveries").all(),
      ).toHaveLength(3);
      expect(
        f.sqlite
          .prepare(
            "SELECT intake_kind,status,body_status FROM document_fetches",
          )
          .get(),
      ).toMatchObject({
        intake_kind: "manual",
        status: 0,
        body_status: "not_provided",
      });
      expect(
        f.sqlite
          .prepare(
            "SELECT status,job_kind,request_count,version FROM ingestion_jobs",
          )
          .get(),
      ).toMatchObject({
        status: "completed",
        job_kind: "manual",
        request_count: 0,
        version: 1,
      });
      expect((await f.store.importBatch(raw)).idempotent).toBe(true);
      const second = await f.store.importBatch(f.batch());
      expect(second.items[0]).toMatchObject({ id, outcome: "unchanged" });
      expect((await f.store.document(id)).version).toBe(d.version);
      expect(
        f.sqlite.prepare("SELECT * FROM knowledge_documents").all(),
      ).toHaveLength(1);
      expect(
        f.sqlite
          .prepare(
            "SELECT * FROM console_audit_logs WHERE action='manual.import'",
          )
          .all(),
      ).toHaveLength(2);
      expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      f.close();
    }
  });
  it("rejects unverified/disabled sources, wrong hosts, credentials, batches, and self-declared authority", async () => {
    const f = await setup();
    try {
      for (const extra of [
        { approved: true },
        { verified: true },
        { admin: true },
        { userId: "admin" },
      ])
        expect(
          ManualImportSchema.safeParse({ ...f.batch(), ...extra }).success,
        ).toBe(false);
      await expect(
        f.store.importBatch(
          f.batch([{ ...f.item, url: "https://other.invalid/article" }]),
        ),
      ).rejects.toThrow();
      await expect(
        f.store.importBatch(
          f.batch([
            { ...f.item, url: "https://example.invalid/a?token=secret" },
          ]),
        ),
      ).rejects.toThrow();
      await expect(
        f.store.importBatch({ ...f.batch(), items: [f.item, f.item, f.item] }),
      ).rejects.toThrow();
      f.sqlite
        .prepare("UPDATE knowledge_sources SET enabled=0 WHERE id=?")
        .run(f.source.id);
      await expect(f.store.importBatch(f.batch())).rejects.toThrow();
      expect(
        f.sqlite.prepare("SELECT * FROM knowledge_documents").all(),
      ).toHaveLength(0);
    } finally {
      f.close();
    }
  });
  it("metadata permission cannot store pasted full text, irrespective of claimed completeness", async () => {
    const f = await setup();
    try {
      await expect(
        f.store.importBatch({
          ...f.batch(),
          items: [
            { ...f.item, body: "无许可第三方正文", bodyStatus: "complete" },
          ],
        }),
      ).rejects.toThrow();
      expect(
        f.sqlite.prepare("SELECT * FROM knowledge_documents").all(),
      ).toHaveLength(0);
      expect(
        f.sqlite.prepare("SELECT * FROM ingestion_jobs").all(),
      ).toHaveLength(0);
    } finally {
      f.close();
    }
  });
  it("licensed text retains explicit date precision, exact evidence, revision and pending status", async () => {
    const f = await setup("licensed_full_text");
    try {
      const body =
        "活动名称：合成讲座\n活动时间：2026年10月20日14:30\n报名截止：2026年10月19日\n结束时间：下周五";
      const imported = await f.store.importBatch({
        ...f.batch(),
        items: [{ ...f.item, body, bodyStatus: "complete" }],
      });
      const evidence = f.sqlite
        .prepare(
          "SELECT * FROM extraction_evidence WHERE candidate_id IS NOT NULL ORDER BY field_name",
        )
        .all();
      expect(evidence).toHaveLength(3);
      for (const e of evidence) {
        expect(body.slice(Number(e.start_offset), Number(e.end_offset))).toBe(
          e.raw_span,
        );
        expect(e.verification_status).toBe("pending");
        expect(e.inferred).toBe(0);
        expect(e.content_revision).toBe(1);
        expect(String(e.input_hash)).toHaveLength(64);
      }
      expect(
        evidence.find((e) => e.field_name === "registrationDeadline"),
      ).toMatchObject({
        date_value: "2026-10-19",
        time_value: null,
        precision: "date",
      });
      expect(evidence.find((e) => e.field_name === "endsAt")).toMatchObject({
        date_value: null,
        precision: "unknown",
      });
      expect((await f.store.document(imported.items[0].id)).bodyStatus).toBe(
        "complete",
      );
      expect(
        f.sqlite.prepare("SELECT * FROM campus_events").all(),
      ).toHaveLength(0);
    } finally {
      f.close();
    }
  });
  it("same title at another URL stays separate, same URL changes require explicit CAS and lose old approval", async () => {
    const f = await setup();
    try {
      const first = await f.store.importBatch(f.batch()),
        id = first.items[0].id;
      await f.store.importBatch(
        f.batch([{ ...f.item, url: "https://example.invalid/2021/article" }]),
      );
      expect(
        f.sqlite.prepare("SELECT * FROM knowledge_documents").all(),
      ).toHaveLength(2);
      await expect(
        f.store.importBatch({
          ...f.batch(),
          items: [{ ...f.item, title: "改动标题", expectedVersion: 999 }],
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const v = (await f.store.document(id)).version;
      const changed = await f.store.importBatch({
        ...f.batch(),
        items: [{ ...f.item, title: "改动标题", expectedVersion: v }],
      });
      expect(changed.items[0]).toMatchObject({ id, outcome: "updated" });
      expect(await f.store.document(id)).toMatchObject({
        contentRevision: 2,
        reviewStatus: "pending",
        publicationStatus: "draft",
      });
    } finally {
      f.close();
    }
  });
  it("approve -> publish -> anonymous whitelist -> withdraw is immediate and stale versions never leak", async () => {
    const f = await setup();
    try {
      const id = (await f.store.importBatch(f.batch())).items[0].id;
      expect((await readPublicContent(f.db, {})).items).toHaveLength(0);
      await f.store.review(id, {
        ...command(1),
        decision: "approved",
        note: "隔离审核批准",
      });
      await f.store.publish(id, { ...command(2), note: "隔离发布批准" });
      const item = (await readPublicContent(f.db, { id, version: 3 })).items[0];
      expect(item).toMatchObject({ id, publishedAt: "2020-01-02" });
      expect(item).not.toHaveProperty("body");
      expect(item).not.toHaveProperty("extractedFields");
      await expect(
        readPublicContent(f.db, { id, version: 2 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await f.store.publish(id, { ...command(3), note: "隔离撤回核验" }, true);
      expect((await readPublicContent(f.db, {})).items).toHaveLength(0);
      await expect(readPublicContent(f.db, { id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(
        f.sqlite
          .prepare(
            "SELECT * FROM content_index_invalidations WHERE document_id=?",
          )
          .all(id).length,
      ).toBeGreaterThan(0);
    } finally {
      f.close();
    }
  });
  it("revocation and concurrent document edit between preparation and batch roll back every import write", async () => {
    const f = await setup();
    try {
      const original = f.db.batch;
      f.db.batch = async (statements) => {
        f.sqlite
          .prepare("UPDATE knowledge_sources SET enabled=0 WHERE id=?")
          .run(f.source.id);
        return original(statements);
      };
      await expect(f.store.importBatch(f.batch())).rejects.toThrow();
      expect(
        f.sqlite.prepare("SELECT * FROM knowledge_documents").all(),
      ).toHaveLength(0);
      expect(
        f.sqlite.prepare("SELECT * FROM ingestion_jobs").all(),
      ).toHaveLength(0);
    } finally {
      f.close();
    }
  });
  it("reviewers cannot import and operators cannot grant full-text permission", async () => {
    const f = await setup();
    try {
      const reviewer = new ManualImportStore(f.db, {
        ...actor,
        role: "reviewer",
      });
      await expect(reviewer.importBatch(f.batch())).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      const operator = new ManualImportStore(f.db, {
        ...actor,
        role: "operator",
      });
      await expect(
        operator.setImportPolicy(f.source.id, {
          ...command(4),
          rightsScope: "licensed_full_text",
          fullTextAuthorized: true,
          note: "伪装批准权限",
          evidenceUrls: ["https://example.invalid/license"],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      f.close();
    }
  });
  it("a concurrent document edit cannot be overwritten by a prepared batch", async () => {
    const f = await setup();
    try {
      const id = (await f.store.importBatch(f.batch())).items[0].id;
      const original = f.db.batch;
      f.db.batch = async (statements) => {
        f.sqlite
          .prepare(
            "UPDATE knowledge_documents SET version=version+1 WHERE id=?",
          )
          .run(id);
        return original(statements);
      };
      await expect(
        f.store.importBatch({
          ...f.batch(),
          items: [{ ...f.item, title: "迟到覆盖", expectedVersion: 1 }],
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await f.store.document(id)).toMatchObject({
        title: f.item.title,
        version: 2,
      });
      expect(
        f.sqlite.prepare("SELECT * FROM ingestion_jobs").all(),
      ).toHaveLength(1);
    } finally {
      f.close();
    }
  });
  it("permission changes are rechecked at commit and complete rolls back on policy races", async () => {
    const f = await setup("licensed_full_text");
    try {
      const original = f.db.batch;
      f.db.batch = async (statements) => {
        f.sqlite
          .prepare(
            "UPDATE knowledge_sources SET manual_policy_version=manual_policy_version+1,manual_rights_scope='metadata_only' WHERE id=?",
          )
          .run(f.source.id);
        return original(statements);
      };
      await expect(
        f.store.importBatch({
          ...f.batch(),
          items: [{ ...f.item, body: "合成正文", bodyStatus: "complete" }],
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        f.sqlite.prepare("SELECT * FROM knowledge_documents").all(),
      ).toHaveLength(0);
    } finally {
      f.close();
    }
  });
  it("the shared daily manual batch budget is atomic and does not reset unrelated quotas", async () => {
    const f = await setup();
    try {
      for (let i = 0; i < 20; i++) await f.store.importBatch(f.batch());
      await expect(f.store.importBatch(f.batch())).rejects.toMatchObject({
        code: "RATE_LIMITED",
      });
      expect(
        f.sqlite.prepare("SELECT * FROM ingestion_jobs").all(),
      ).toHaveLength(20);
      expect(
        f.sqlite.prepare("SELECT * FROM knowledge_documents").all(),
      ).toHaveLength(1);
    } finally {
      f.close();
    }
  });
  it("a narrower manual license immediately removes body hits without hiding permitted metadata", async () => {
    const f = await setup("licensed_full_text");
    try {
      const id = (
        await f.store.importBatch({
          ...f.batch(),
          items: [{ ...f.item, body: "自有合成正文", bodyStatus: "complete" }],
        })
      ).items[0].id;
      await f.store.review(id, {
        ...command(1),
        decision: "approved",
        note: "隔离正文核验",
      });
      await f.store.publish(id, { ...command(2), note: "隔离发布核验" });
      expect(
        await filterPublicContent(f.db, [{ id, version: 3 }], "full_text"),
      ).toHaveLength(1);
      await f.store.setImportPolicy(f.source.id, {
        ...command(4),
        rightsScope: "metadata_only",
        evidenceUrls: ["https://example.invalid/license"],
        note: "隔离撤销正文用途",
      });
      expect(
        await filterPublicContent(f.db, [{ id, version: 3 }], "full_text"),
      ).toHaveLength(0);
      expect((await readPublicContent(f.db, { id })).items).toHaveLength(1);
      expect(
        f.sqlite
          .prepare(
            "SELECT * FROM content_index_invalidations WHERE reason='manual_policy_changed'",
          )
          .all(),
      ).toHaveLength(1);
    } finally {
      f.close();
    }
  });
  it("explicit parser rejects invalid dates/hours and keeps unanchored expressions unknown", () => {
    expect(parseCampusTime("2026年2月30日14:00").precision).toBe("unknown");
    expect(parseCampusTime("2026年10月20日25:00").precision).toBe("unknown");
    expect(parseCampusTime("下周五").precision).toBe("unknown");
    expect(parseCampusTime("2026-10-2014:30").precision).toBe("unknown");
    expect(parseCampusTime("2026年10月20日")).toMatchObject({
      date: "2026-10-20",
      time: null,
      iso: null,
      precision: "date",
    });
  });
  it("editing cannot smuggle unlicensed text through the legacy editor", async () => {
    const f = await setup();
    try {
      const id = (await f.store.importBatch(f.batch())).items[0].id;
      const snapshot = await f.store.version(id, 1);
      await expect(
        f.store.writeContent(id, {
          ...snapshot.input,
          ...command(1),
          body: "无许可第三方正文",
        }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(
        f.store.writeContent(id, {
          ...snapshot.input,
          ...command(1),
          body: "无许可第三方正文",
          bodyStatus: "complete",
          rightsScope: "licensed_full_text",
        }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      const edit = {
        ...snapshot.input,
        ...command(1),
        title: "隔离元数据修订",
      };
      await f.store.writeContent(id, edit);
      expect((await f.store.writeContent(id, edit)).idempotent).toBe(true);
      expect((await f.store.document(id)).version).toBe(2);
    } finally {
      f.close();
    }
  });
  it("edit and restore atomically reject a license revoked while preparing the batch", async () => {
    const f = await setup("licensed_full_text");
    try {
      const id = (
        await f.store.importBatch({
          ...f.batch(),
          items: [{ ...f.item, body: "自有合成正文", bodyStatus: "complete" }],
        })
      ).items[0].id;
      const original = f.db.batch;
      f.db.batch = async (statements) => {
        f.sqlite
          .prepare(
            "UPDATE knowledge_sources SET manual_policy_version=manual_policy_version+1,manual_rights_scope='metadata_only' WHERE id=?",
          )
          .run(f.source.id);
        return original(statements);
      };
      await expect(
        f.store.restore(id, { ...command(1), version: 1 }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await f.store.document(id)).version).toBe(1);
      expect(
        f.sqlite
          .prepare(
            "SELECT * FROM console_commands WHERE action='document.restore'",
          )
          .all(),
      ).toHaveLength(0);
      expect(
        f.sqlite
          .prepare("SELECT * FROM console_content_versions WHERE document_id=?")
          .all(id),
      ).toHaveLength(1);
    } finally {
      f.close();
    }
  });
});

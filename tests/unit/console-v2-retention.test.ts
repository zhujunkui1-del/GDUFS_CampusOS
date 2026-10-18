import { it, expect, describe } from "vitest";
import {
  consoleV2Fixture,
  sourceInput,
  confirmed,
} from "../fixtures/console-v2";
import { ConsoleRetentionStore } from "@/lib/server/console/v2-retention";
const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
async function setup(purge = true) {
  const f = await consoleV2Fixture(),
    store = new ConsoleRetentionStore(
      f.db,
      f.actor,
      undefined,
      undefined,
      purge,
    ),
    s = await store.createGovernedSource(
      sourceInput({ governance: confirmed }),
    );
  const doc = (id: string, date: string | null, state = "withdrawn") => {
    f.sqlite
      .prepare(
        "INSERT INTO knowledge_documents(id,source_id,title,url,body,content_hash,fetched_at,campus_scope,data_domain,published_at,lifecycle_status,publication_status,content_revision,input_hash,rights_scope,content_type,knowledge_category) VALUES(?,?,?,?,?,?,?,'all','campus_announcements',?,?,?,1,?,'metadata_only','notice','campus_life')",
      )
      .run(
        id,
        s.id,
        id,
        "https://example.invalid/" + id,
        "隔离内容".repeat(100),
        id,
        "2026-10-18",
        date,
        state,
        state === "withdrawn" ? "withdrawn" : "draft",
        "a".repeat(64),
      );
    f.sqlite
      .prepare(
        "INSERT INTO console_content_versions(document_id,version,snapshot_json,created_by,created_at,content_revision,input_hash) VALUES(?,1,?,?,?,1,?)",
      )
      .run(
        id,
        JSON.stringify({ input: { body: "隔离旧正文".repeat(100) } }),
        f.actor.id,
        "2026-10-18",
        "a".repeat(64),
      );
    return id;
  };
  const preview = async () => {
    const r = await store.createPlan({
      commandId: crypto.randomUUID(),
      filters: { cutoff: "2025-09-01" },
    });
    let p = await store.plan(r.id);
    while (p.state === "previewing") {
      await store.actPlan(r.id, { ...cmd(p.version), action: "scan" });
      p = await store.plan(r.id);
    }
    return p;
  };
  return { ...f, store, s, doc, preview };
}
describe("V2 whitelist, cutoff and bounded retention (disposable DB only)", () => {
  it("preserves a prior manual withdrawal across cleanup and explicit whitelist restoration", async () => {
    const f = await setup();
    try {
      f.doc("withdrawn", "2020-01-01");
      f.sqlite.exec(
        "INSERT INTO console_document_controls(document_id,hold_reason,hold_at) VALUES('withdrawn','manual_withdrawal','2026-01-01')",
      );
      let p = await f.preview();
      await f.store.actPlan(p.id, {
        ...cmd(p.version),
        action: "mark",
        confirmation: p.confirmation,
      });
      p = await f.store.plan(p.id);
      for (let i = 0; i < 10 && p.state !== "complete"; i++) {
        await f.store.actPlan(p.id, {
          ...cmd(p.version),
          action: "purge",
          confirmation: "永久" + p.confirmation,
        });
        p = await f.store.plan(p.id);
      }
      await f.store.protection({
        ...cmd(2),
        type: "document",
        targetId: "withdrawn",
        active: true,
        historyExempt: true,
        expiresAt: null,
        reason: "明确保留并恢复资料供重新核验",
      });
      await f.store.releaseTombstone("withdrawn", cmd(3));
      expect(
        f.sqlite
          .prepare(
            "SELECT hold_reason FROM console_document_controls WHERE document_id='withdrawn'",
          )
          .get()?.hold_reason,
      ).toBe("manual_withdrawal");
      expect(
        f.sqlite
          .prepare("SELECT count(*) n FROM console_public_documents")
          .get()?.n,
      ).toBe(0);
    } finally {
      f.close();
    }
  });
  it("separates old/valid/unknown/protected/referenced and Shanghai cutoff dates", async () => {
    const f = await setup();
    try {
      f.doc("old", "2024-01-01");
      f.doc("policy", "2020-01-01", "active");
      f.doc("unknown", null);
      f.doc("boundary", "2025-08-31T16:00:00Z");
      f.doc("protected", "2023-01-01");
      f.doc("favorite", "2023-01-01");
      f.sqlite.exec(
        "INSERT INTO users(id,display_name) VALUES('u','fixture');INSERT INTO user_favorites VALUES('u','document','favorite')",
      );
      await f.store.protection({
        ...cmd(1),
        type: "document",
        targetId: "protected",
        active: true,
        historyExempt: false,
        expiresAt: null,
        reason: "长期保留隔离政策",
      });
      const p = await f.preview();
      expect(p.scanned).toBe(4);
      expect(p.unknownDate).toBe(1);
      const counts = Object.fromEntries(
        p.counts.map((r) => [r.classification, r.n]),
      );
      expect(counts).toMatchObject({
        candidate: 1,
        valid: 1,
        protected: 1,
        dependency: 1,
      });
      expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      f.close();
    }
  });
  it("requires both confirmations, purges bounded large payloads and blocks reintroduction without deleting parents/audit", async () => {
    const f = await setup();
    try {
      f.doc("old", "2020-01-01");
      let p = await f.preview();
      await expect(
        f.store.actPlan(p.id, { ...cmd(p.version), action: "mark" }),
      ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
      await f.store.actPlan(p.id, {
        ...cmd(p.version),
        action: "mark",
        confirmation: p.confirmation,
      });
      p = await f.store.plan(p.id);
      expect(p.state).toBe("marked");
      await expect(
        f.store.actPlan(p.id, { ...cmd(p.version), action: "purge" }),
      ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
      for (let i = 0; i < 10 && p.state !== "complete"; i++) {
        await f.store.actPlan(p.id, {
          ...cmd(p.version),
          action: "purge",
          confirmation: "永久" + p.confirmation,
        });
        p = await f.store.plan(p.id);
      }
      expect(p.state).toBe("complete");
      expect(
        f.sqlite
          .prepare("SELECT body FROM knowledge_documents WHERE id='old'")
          .get()?.body,
      ).toBe("内容已清理");
      expect(
        f.sqlite
          .prepare("SELECT count(*) n FROM console_cleanup_tombstones")
          .get()?.n,
      ).toBe(1);
      expect(
        f.sqlite
          .prepare("SELECT count(*) n FROM console_content_versions")
          .get()?.n,
      ).toBe(2);
      expect(
        f.sqlite.prepare("SELECT count(*) n FROM console_audit_logs").get()?.n,
      ).toBeGreaterThan(5);
      expect(() =>
        f.sqlite.exec(
          "UPDATE knowledge_documents SET input_hash='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',body='late content' WHERE id='old'",
        ),
      ).toThrow(/RETENTION/);
      await f.store.protection({
        ...cmd(2),
        type: "document",
        targetId: "old",
        active: true,
        historyExempt: true,
        expiresAt: null,
        reason: "明确保留并重新导入长期政策",
      });
      await f.store.releaseTombstone("old", cmd(3));
      f.sqlite.exec(
        "UPDATE knowledge_documents SET input_hash='cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',body='重新合法导入的内容',content_revision=content_revision+1 WHERE id='old'",
      );
      expect(
        f.sqlite
          .prepare(
            "SELECT publication_status FROM knowledge_documents WHERE id='old'",
          )
          .get()?.publication_status,
      ).toBe("withdrawn");
      expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      f.close();
    }
  });
  it("keeps hard cleanup disabled outside an explicitly disposable local fixture", async () => {
    const f = await setup(false);
    try {
      f.doc("old", "2020-01-01");
      let p = await f.preview();
      await f.store.actPlan(p.id, {
        ...cmd(p.version),
        action: "mark",
        confirmation: p.confirmation,
      });
      p = await f.store.plan(p.id);
      await expect(
        f.store.actPlan(p.id, {
          ...cmd(p.version),
          action: "purge",
          confirmation: "永久" + p.confirmation,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        f.sqlite.prepare("SELECT body FROM knowledge_documents").get()?.body,
      ).not.toBe("内容已清理");
    } finally {
      f.close();
    }
  });
  it("rechecks protection/version before each batch and handles pause/resume", async () => {
    const f = await setup();
    try {
      f.doc("old", "2020-01-01");
      const p = await f.store.createPlan({
        commandId: crypto.randomUUID(),
        filters: { cutoff: "2025-09-01" },
      });
      await f.store.actPlan(p.id, { ...cmd(p.version), action: "pause" });
      let detail = await f.store.plan(p.id);
      expect(detail.state).toBe("paused");
      await f.store.actPlan(p.id, { ...cmd(detail.version), action: "resume" });
      detail = await f.store.plan(p.id);
      await f.store.actPlan(p.id, { ...cmd(detail.version), action: "scan" });
      detail = await f.store.plan(p.id);
      await f.store.protection({
        ...cmd(1),
        type: "document",
        targetId: "old",
        active: true,
        historyExempt: false,
        expiresAt: null,
        reason: "预览后新加的保护",
      });
      await f.store.actPlan(p.id, {
        ...cmd(detail.version),
        action: "mark",
        confirmation: detail.confirmation,
      });
      expect(
        f.sqlite.prepare("SELECT stage FROM console_cleanup_items").get()
          ?.stage,
      ).toBe("blocked");
    } finally {
      f.close();
    }
  });
  it("enforces cutoff on every intake and permits only explicit whitelist history exemption", async () => {
    const f = await setup();
    try {
      const settings = await f.store.engineSettings();
      await f.store.saveEngineSettings({
        ...cmd(Number(settings?.version)),
        syncHours: 24,
        autoSync: true,
        networkBudget: 20,
        earliestImportDay: "2025-09-01",
        confirmImportCutoff: true,
        note: "批准全局导入日期门禁",
      });
      expect(() => f.doc("old", "2020-01-01")).toThrow(/RETENTION_CUTOFF/);
      expect(() => f.doc("unknown", null)).toThrow(/RETENTION_CUTOFF/);
      f.doc("allowed", "2025-09-01");
      await f.store.protection({
        ...cmd(1),
        type: "source",
        targetId: f.s.id,
        active: true,
        historyExempt: true,
        expiresAt: null,
        reason: "明确保留长期有效的历史政策",
      });
      f.doc("old-approved", "2020-01-01");
      expect(
        f.sqlite.prepare("SELECT count(*) n FROM knowledge_documents").get()?.n,
      ).toBe(2);
      await f.store.archiveSource(f.s.id, cmd(2));
      expect((await f.store.sourceV2(f.s.id)).archivedAt).toBeTruthy();
      expect(
        f.sqlite
          .prepare("SELECT active FROM console_protections WHERE target_id=?")
          .get(f.s.id)?.active,
      ).toBe(1);
      expect(
        f.sqlite.prepare("SELECT count(*) n FROM knowledge_documents").get()?.n,
      ).toBe(2);
    } finally {
      f.close();
    }
  });
  it("expired protection stops protecting and ordinary operators cannot alter whitelist/policies", async () => {
    const f = await setup();
    try {
      f.doc("old", "2020-01-01");
      await f.store.protection({
        ...cmd(1),
        type: "document",
        targetId: "old",
        active: true,
        historyExempt: false,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        reason: "隔离限期保留记录",
      });
      f.sqlite.prepare("UPDATE console_protections SET expires_at_ms=1").run();
      const p = await f.preview();
      expect(p.counts[0]).toMatchObject({ classification: "candidate", n: 1 });
      const operator = new ConsoleRetentionStore(f.db, {
        ...f.actor,
        role: "operator",
      });
      await expect(operator.protection({})).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect((await f.store.protections({ status: "expired" })).total).toBe(1);
    } finally {
      f.close();
    }
  });
});

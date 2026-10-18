import { it, expect, describe } from "vitest";
import {
  consoleV2Fixture,
  sourceInput,
  confirmed,
} from "../fixtures/console-v2";
import { ConsoleAutomationStore } from "@/lib/server/console/v2-automation";
import { contentCompleteness } from "@/lib/ingestion/completeness";
const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
async function setup() {
  const f = await consoleV2Fixture(),
    store = new ConsoleAutomationStore(f.db, f.actor);
  const s = await store.createGovernedSource(
    sourceInput({ governance: confirmed }),
  );
  await store.verifySource(s.id, {
    ...cmd(1),
    status: "verified",
    officialStatus: "verified_official",
    permissionStatus: "approved",
    authorityConfirmed: true,
    note: "隔离许可证明",
    evidenceUrls: ["https://example.invalid/license"],
  });
  await store.setImportPolicy(s.id, {
    ...cmd(2),
    rightsScope: "metadata_only",
    evidenceUrls: ["https://example.invalid/license"],
    note: "隔离元数据导入许可",
    fullTextAuthorized: false,
  });
  await store.setAutoPolicy(s.id, {
    ...cmd(3),
    enabled: true,
    rightsScope: "metadata_only",
    defaultCategory: "campus_life",
    unknownDate: "review",
    allowUnofficial: false,
    validityDays: 1,
    evidenceUrls: ["https://example.invalid/license"],
    note: "管理员预先批准隔离来源自动发布",
  });
  const batch = {
    commandId: crypto.randomUUID(),
    sourceId: s.id,
    sourceVersion: 4,
    items: [
      {
        title: "正常校园公告",
        url: "https://example.invalid/article",
        publishedAt: "2026-10-16",
        campusScope: "all",
        contentType: "notice",
        knowledgeCategory: "campus_life",
      },
    ],
  };
  return { ...f, store, s, batch };
}
describe("V2 restricted system publisher", () => {
  it("requires original evidence, publishes ordinary notices without event fields, records system audit and idempotent checks", async () => {
    const f = await setup();
    try {
      const r = await f.store.importBatch(f.batch),
        id = r.items[0].id;
      expect(r.processing[0]).toMatchObject({
        outcome: "review",
        published: false,
      });
      let d = await f.store.document(id);
      await f.store.attest(id, {
        ...cmd(d.version),
        evidenceUrls: [d.url],
        note: "管理员核对原文标题及发布日期",
      });
      expect(await f.store.analyse(id)).toMatchObject({
        outcome: "pass",
        published: true,
      });
      d = await f.store.document(id);
      expect(d.publicationStatus).toBe("published");
      expect(
        f.sqlite
          .prepare("SELECT count(*) n FROM console_public_documents")
          .get()?.n,
      ).toBe(1);
      expect(
        f.sqlite
          .prepare(
            "SELECT actor_id FROM console_audit_logs WHERE action='document.auto_publish'",
          )
          .get()?.actor_id,
      ).toBe("sys-console-publisher");
      expect((await f.store.version(id, d.version)).input.title).toBe(
        "正常校园公告",
      );
      expect(
        f.sqlite
          .prepare("SELECT count(*) n FROM console_revision_payloads")
          .get()?.n,
      ).toBe(1);
      await f.store.analyse(id);
      expect(
        f.sqlite
          .prepare("SELECT count(*) n FROM console_auto_publications")
          .get()?.n,
      ).toBe(1);
      await f.store.publish(
        id,
        { ...cmd(d.version), note: "管理员撤回隔离通知" },
        true,
      );
      expect(await f.store.analyse(id)).toMatchObject({
        outcome: "blocked",
        published: false,
      });
      expect(
        f.sqlite
          .prepare("SELECT count(*) n FROM console_public_documents")
          .get()?.n,
      ).toBe(0);
    } finally {
      f.close();
    }
  });
  it("policy revocation hides an auto-published document immediately without altering another document", async () => {
    const f = await setup();
    try {
      const r = await f.store.importBatch(f.batch),
        id = r.items[0].id;
      const d = await f.store.document(id);
      await f.store.attest(id, {
        ...cmd(d.version),
        evidenceUrls: [d.url],
        note: "隔离原文核对证据",
      });
      await f.store.analyse(id);
      f.sqlite
        .prepare(
          "UPDATE console_publication_policies SET enabled=0,version=version+1",
        )
        .run();
      expect(
        f.sqlite
          .prepare("SELECT count(*) n FROM console_public_documents")
          .get()?.n,
      ).toBe(0);
      expect(
        f.sqlite
          .prepare("SELECT count(*) n FROM content_index_invalidations")
          .get()?.n,
      ).toBeGreaterThan(0);
    } finally {
      f.close();
    }
  });
  it("does not let the publisher create policies, human sessions or arbitrary commands", async () => {
    const f = await setup();
    try {
      const machine = new ConsoleAutomationStore(f.db, {
        id: "sys-console-publisher",
        email: "publisher@system.invalid",
        role: "operator",
      });
      await expect(machine.setAutoPolicy(f.s.id, {})).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(() =>
        f.sqlite
          .prepare(
            "INSERT INTO console_commands(id,admin_id,action,target_type,target_id,expected_version,request_hash,details_json) VALUES('bad','sys-console-publisher','source.auto-policy','source',?,4,'bad','{}')",
          )
          .run(f.s.id),
      ).toThrow();
    } finally {
      f.close();
    }
  });
  it("keeps date-only precision and distinguishes activity/deadline/cancellation exceptions", async () => {
    const f = await setup();
    try {
      const r = await f.store.importBatch(f.batch),
        d = await f.store.document(r.items[0].id);
      const context = {
        rights: "metadata_only",
        unknownDate: "review",
        provenance: true,
        defaultCategory: "campus_life",
      };
      expect(contentCompleteness(d, context)).toMatchObject({
        outcome: "pass",
        fields: { publishedPrecision: "date" },
      });
      const activity = {
        ...d,
        title: "讲座报名",
        body: "活动名称：讲座\n活动时间：2026年10月20日\n报名截止：2026年10月18日",
      };
      const a = contentCompleteness(activity, context);
      expect(a.fields.events[0].startsAt).toBeNull();
      expect(a.fields.events[0].timeEvidence?.[0].precision).toBe("date");
      expect(
        a.fields.events[0].timeEvidence?.find(
          (t) => t.field === "registrationDeadline",
        )?.date,
      ).toBe("2026-10-18");
      expect(
        contentCompleteness(
          { ...activity, body: "活动名称：讲座\n报名截止：2026年10月18日" },
          context,
        ).issues.some((i) => i.code === "event_time"),
      ).toBe(true);
      expect(
        contentCompleteness({ ...d, publishedAt: null }, context).outcome,
      ).toBe("review");
      expect(
        contentCompleteness(
          { ...d, publishedAt: null },
          { ...context, unknownDate: "metadata_unknown" },
        ).outcome,
      ).toBe("pass");
    } finally {
      f.close();
    }
  });
});

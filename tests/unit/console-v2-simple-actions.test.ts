import { describe, it, expect } from "vitest";
import { consoleV2Fixture, sourceInput, actor } from "../fixtures/console-v2";
import { ConsoleRetentionStore } from "@/lib/server/console/v2-retention";
import { ConsoleSyncStore } from "@/lib/server/console/v2-sync";
const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
describe("Console administrator simplification", () => {
  it("matches visible source names, not hidden aliases, organization or catalog numbers", async () => {
    const f = await consoleV2Fixture();
    try {
      await f.store.createGovernedSource(
        sourceInput({
          displayName: "图书馆",
          sourceAliases: ["广外", "12345"],
        }),
      );
      await f.store.createGovernedSource(
        sourceInput({
          displayName: "广外校园",
          websiteUrl: "https://second.invalid/",
        }),
      );
      expect(
        (await f.store.sourcesV2({ q: "广外" })).items.map(
          (s) => s.displayName,
        ),
      ).toEqual(["广外校园"]);
      expect((await f.store.sourcesV2({ q: "12345" })).total).toBe(0);
      expect((await f.store.sourcesV2({ q: "%" })).total).toBe(0);
    } finally {
      f.close();
    }
  });
  it("one switch persists enabled/closed without fabricating evidence or collection permission", async () => {
    const f = await consoleV2Fixture();
    try {
      const s = await f.store.createGovernedSource(sourceInput());
      await f.store.enableSource(s.id, { ...cmd(1), enabled: true });
      expect(await f.store.sourceV2(s.id)).toMatchObject({
        enabled: true,
        operating: "active",
        affiliation: "unknown",
        automatic: false,
        affiliationEvidence: [],
      });
      expect((await f.store.sourcesV2({ state: "enabled" })).total).toBe(1);
      expect(
        (await new ConsoleSyncStore(f.db, actor).dashboard({})).stats.enabled,
      ).toBe(1);
      await f.store.enableSource(s.id, { ...cmd(2), enabled: false });
      expect(await f.store.sourceV2(s.id)).toMatchObject({
        enabled: false,
        operating: "closed",
        nextSyncAt: null,
      });
      expect((await f.store.sourcesV2({ state: "closed" })).total).toBe(1);
      await expect(
        f.store.enableSource(s.id, { ...cmd(1), enabled: true }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      f.close();
    }
  });
  it("whitelist additions are permanent and exempt history cutoff even if a legacy caller supplies an expiry", async () => {
    const f = await consoleV2Fixture();
    try {
      const store = new ConsoleRetentionStore(f.db, actor),
        s = await store.createGovernedSource(sourceInput());
      await store.protection({
        ...cmd(1),
        type: "source",
        targetId: s.id,
        active: true,
        historyExempt: false,
        expiresAt: "2020-01-01T00:00:00Z",
      });
      expect(
        f.sqlite
          .prepare(
            "SELECT active,history_exempt,expires_at_ms,reason FROM console_protections",
          )
          .get(),
      ).toMatchObject({
        active: 1,
        history_exempt: 1,
        expires_at_ms: null,
        reason: "管理员加入白名单",
      });
      await store.protection({
        ...cmd(2),
        type: "source",
        targetId: s.id,
        active: false,
      });
      expect((await store.protections({})).total).toBe(0);
      expect(
        f.sqlite
          .prepare(
            "SELECT count(*) n FROM console_audit_logs WHERE action LIKE 'whitelist.%'",
          )
          .get()?.n,
      ).toBe(2);
    } finally {
      f.close();
    }
  });
  it("imports administrator metadata and reviews without notes or invented publication dates; document versions resolve on the server", async () => {
    const f = await consoleV2Fixture();
    try {
      const store = new ConsoleRetentionStore(f.db, actor),
        s = await store.createGovernedSource(sourceInput());
      await store.enableSource(s.id, { ...cmd(1), enabled: true });
      const item = {
        title: "隔离公告",
        url: "https://example.invalid/notice",
        publishedAt: null,
        campusScope: "all",
        contentType: "notice",
        knowledgeCategory: "campus_life",
        bodyStatus: "not_provided",
      };
      const batch = () => ({
        commandId: crypto.randomUUID(),
        sourceId: s.id,
        sourceVersion: 2,
        items: [item],
      });
      const id = (await store.importBatch(batch())).items[0].id;
      let d = await store.document(id);
      expect(d.publishedAt).toBeNull();
      await store.review(id, { ...cmd(d.version), decision: "approved" });
      expect((await store.document(id)).reviewStatus).toBe("approved");
      expect(
        f.sqlite
          .prepare(
            "SELECT note FROM console_content_reviews WHERE document_id=?",
          )
          .get(id)?.note,
      ).toBe("管理员批准");
      await store.importBatch({
        ...batch(),
        items: [{ ...item, title: "更新的隔离公告" }],
      });
      d = await store.document(id);
      expect(d.title).toBe("更新的隔离公告");
      expect(d.reviewStatus).toBe("pending");
      expect(d.contentRevision).toBe(2);
      expect(
        (await store.articlesV2({ q: "第三方正文", titleOnly: "1" })).total,
      ).toBe(0);
      await expect(
        store.importBatch({
          ...batch(),
          items: [{ ...item, bodyStatus: "complete", body: "无许可全文" }],
        }),
      ).rejects.toThrow();
    } finally {
      f.close();
    }
  });
});

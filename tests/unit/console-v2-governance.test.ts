import { describe, it, expect } from "vitest";
import { sqliteD1 } from "../fixtures/sqlite-d1";
import { ConsoleGovernanceStore } from "@/lib/server/console/v2-governance";
const actor = {
  id: "v2-fixture-admin",
  email: "v2@example.invalid",
  role: "admin" as const,
};
const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
export async function consoleV2Fixture() {
  const f = sqliteD1();
  f.sqlite
    .prepare("INSERT INTO console_admins(id,email,role) VALUES(?,?,'admin')")
    .run(actor.id, actor.email);
  return { ...f, actor, store: new ConsoleGovernanceStore(f.db, actor) };
}
export const sourceInput = (extra: object = {}) => ({
  commandId: crypto.randomUUID(),
  displayName: "隔离来源",
  sourceType: "official_web",
  organization: "隔离广外机构",
  campusScope: "all",
  websiteUrl: "https://example.invalid/",
  wechatId: null,
  evidenceUrls: [],
  priority: 3,
  connectorType: "disabled",
  fetchPolicy: { mode: "disabled", maxRequests: 0 },
  ...extra,
});
export const confirmed = {
  affiliation: "confirmed",
  operating: "active",
  affiliationEvidence: ["https://example.invalid/relation"],
  operatingEvidence: ["https://example.invalid/current"],
  note: "隔离核验，不是实际学校来源",
  enabled: true,
  retainHistory: true,
};
describe("Console V2 source governance (isolated SQLite)", () => {
  it("two confirmed facts enable a registry entry without granting collection/official/full-text rights", async () => {
    const f = await consoleV2Fixture();
    try {
      const created = await f.store.createGovernedSource(
        sourceInput({ governance: confirmed }),
      );
      const s = await f.store.sourceV2(created.id);
      expect(s.enabled).toBe(true);
      expect(s.automatic).toBe(false);
      const raw = await f.store.source(created.id);
      expect(raw.officialStatus).toBe("unverified");
      expect(raw.permissionStatus).toBe("unreviewed");
      expect(
        f.sqlite
          .prepare("SELECT count(*) n FROM source_collection_policies")
          .get()?.n,
      ).toBe(0);
      expect((await f.store.sourceV2(created.id)).version).toBe(1);
    } finally {
      f.close();
    }
  });
  it("requires actual evidence and does not assume candidate activity from the catalog", async () => {
    const f = await consoleV2Fixture();
    try {
      await expect(
        f.store.createGovernedSource(
          sourceInput({ governance: { ...confirmed, operatingEvidence: [] } }),
        ),
      ).rejects.toThrow();
      expect(
        f.sqlite.prepare("SELECT count(*) n FROM knowledge_sources").get()?.n,
      ).toBe(0);
      const s = await f.store.createGovernedSource(sourceInput());
      await expect(
        f.store.enableSource(s.id, { ...cmd(1), enabled: true }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      expect((await f.store.sourceV2(s.id)).enabled).toBe(false);
    } finally {
      f.close();
    }
  });
  it("supports WeChat and mini-program identifiers without fictional website URLs or name merging", async () => {
    const f = await consoleV2Fixture();
    try {
      const a = await f.store.createGovernedSource(
        sourceInput({
          sourceType: "wechat_subscription",
          websiteUrl: null,
          wechatId: "gh_fixture",
          governance: confirmed,
        }),
      );
      const b = await f.store.createGovernedSource(
        sourceInput({
          sourceType: "mini_program",
          websiteUrl: null,
          miniProgramId: "wx-fixture-app",
          governance: confirmed,
        }),
      );
      expect(a.id).not.toBe(b.id);
      expect((await f.store.sourceV2(b.id)).websiteUrl).toBeNull();
      expect((await f.store.sourcesV2({ q: "隔离来源" })).total).toBe(2);
      await expect(
        f.store.createGovernedSource(
          sourceInput({
            sourceType: "mini_program",
            websiteUrl: null,
            miniProgramId: "wx-fixture-app",
          }),
        ),
      ).rejects.toThrow();
    } finally {
      f.close();
    }
  });
  it("source edits preserve confirmed identity for display changes, invalidate changed identity, and support audited soft deletion", async () => {
    const f = await consoleV2Fixture();
    try {
      const x = await f.store.createGovernedSource(
        sourceInput({ governance: confirmed }),
      );
      const s = await f.store.source(x.id);
      const { commandId: ignored, ...base } = sourceInput();
      void ignored;
      await f.store.editSource(x.id, {
        ...base,
        ...cmd(s.version),
        displayName: "改名后仍为同一隔离来源",
      });
      expect((await f.store.sourceV2(x.id)).enabled).toBe(true);
      await f.store.editSource(x.id, {
        ...base,
        ...cmd(2),
        websiteUrl: "https://different.invalid/",
      });
      expect((await f.store.sourceV2(x.id)).affiliation).toBe("unknown");
      expect((await f.store.sourceV2(x.id)).enabled).toBe(false);
      await f.store.archiveSource(x.id, cmd(3));
      expect((await f.store.sourcesV2({})).total).toBe(0);
      expect((await f.store.sourcesV2({ state: "archived" })).total).toBe(1);
      await f.store.restoreSource(x.id, cmd(4));
      expect((await f.store.sourceV2(x.id)).enabled).toBe(false);
      expect(
        f.sqlite
          .prepare("SELECT * FROM console_audit_logs WHERE target_id=?")
          .all(x.id).length,
      ).toBe(5);
    } finally {
      f.close();
    }
  });
  it("stores bounded global/source cadence, rejects >24 hours, enforces admin/CAS and explicit import-cutoff confirmation", async () => {
    const f = await consoleV2Fixture();
    try {
      const policy = {
        ...cmd(1),
        syncHours: 6,
        autoSync: true,
        networkBudget: 20,
        earliestImportDay: null,
        note: "隔离全局配置",
      };
      await f.store.saveEngineSettings(policy);
      expect((await f.store.engineSettings())?.sync_hours).toBe(6);
      await expect(
        f.store.saveEngineSettings({ ...policy, ...cmd(1) }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        f.store.saveEngineSettings({ ...policy, ...cmd(2), syncHours: 25 }),
      ).rejects.toThrow();
      await expect(
        f.store.saveEngineSettings({
          ...policy,
          ...cmd(2),
          earliestImportDay: "2025-09-01",
        }),
      ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
      const operator = new ConsoleGovernanceStore(f.db, {
        ...actor,
        role: "operator",
      });
      await expect(
        operator.saveEngineSettings({ ...policy, ...cmd(2) }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const s = await f.store.createGovernedSource(
        sourceInput({ governance: confirmed }),
      );
      await f.store.saveSourceSync(s.id, {
        ...cmd(1),
        hours: 1,
        note: "隔离单源周期",
      });
      expect((await f.store.sourceV2(s.id)).syncHours).toBe(1);
    } finally {
      f.close();
    }
  });
  it("paginates/searches/sorts and rejects query injection; no metrics are invented", async () => {
    const f = await consoleV2Fixture();
    try {
      for (let i = 0; i < 4; i++)
        await f.store.createGovernedSource(
          sourceInput({
            displayName: `隔离${i}`,
            websiteUrl: `https://example${i}.invalid/`,
          }),
        );
      const list = await f.store.sourcesV2({
        limit: 2,
        offset: 2,
        sort: "name",
        direction: "asc",
      });
      expect(list.total).toBe(4);
      expect(list.items).toHaveLength(2);
      expect(
        (await f.store.sourcesV2({ q: "' OR 1=1 --" })).items,
      ).toHaveLength(0);
      await expect(
        f.store.sourcesV2({ sort: "name;DROP TABLE users" }),
      ).rejects.toThrow();
      const dash = await f.store.dashboard({});
      expect(dash.storage).toHaveLength(0);
      expect(dash.scheduler).toBe("not_connected");
      expect(dash.autoPublishedToday).toBeNull();
      expect(f.sqlite.prepare("PRAGMA foreign_key_check").all()).toHaveLength(
        0,
      );
    } finally {
      f.close();
    }
  });
});

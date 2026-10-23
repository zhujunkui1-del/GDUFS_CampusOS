import { describe, it, expect } from "vitest";
import {
  consoleV2Fixture,
  sourceInput,
  confirmed,
  actor,
} from "../fixtures/console-v2";
import { ConsoleGovernanceStore } from "@/lib/server/console/v2-governance";
const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
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
      await f.store.enableSource(s.id, { ...cmd(1), enabled: true });
      expect((await f.store.sourceV2(s.id)).enabled).toBe(true);
      expect((await f.store.sourceV2(s.id)).automatic).toBe(false);
      expect((await f.store.sourceV2(s.id)).affiliation).toBe("unknown");
      await f.store.enableSource(s.id, { ...cmd(2), enabled: false });
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
  it("stores one bounded global cadence, clears legacy source overrides, rejects source cadence, and enforces admin/CAS", async () => {
    const f = await consoleV2Fixture();
    try {
      const policy = {
        ...cmd(1),
        syncHours: 6,
        autoSync: true,
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
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
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
      f.sqlite
        .prepare(
          "UPDATE knowledge_sources SET sync_hours_override=1 WHERE id=?",
        )
        .run(s.id);
      await f.store.saveEngineSettings({
        ...policy,
        ...cmd(2),
        syncHours: 3,
        note: "隔离统一间隔",
      });
      expect(
        f.sqlite
          .prepare(
            "SELECT sync_hours_override FROM knowledge_sources WHERE id=?",
          )
          .get(s.id)?.sync_hours_override,
      ).toBeNull();
      await expect(
        f.store.saveSourceSync(s.id, {
          ...cmd(1),
          hours: 1,
          note: "隔离单站间隔",
        }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      expect("syncOverride" in (await f.store.sourceV2(s.id))).toBe(false);
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
  it("summarizes configured, candidate, and missing official website profiles globally", async () => {
    const f = await consoleV2Fixture();
    try {
      const created = await f.store.createGovernedSource(
        sourceInput({
          displayName: "入口状态隔离官网",
          websiteUrl: "https://profile.example.invalid/",
          governance: confirmed,
        }),
      );
      expect(await f.store.officialWebCollection({})).toMatchObject({
        allTotal: 1,
        configuredTotal: 0,
        readiness: {
          candidateTotal: 0,
          missingProfileTotal: 1,
          policyPendingTotal: 0,
          sourcePendingTotal: 0,
          activeJobTotal: 0,
          readyTotal: 0,
        },
      });
      const source = await f.store.source(created.id);
      await f.store.saveWebProfile(created.id, {
        ...cmd(source.version),
        configurationStatus: "discovered",
        entryUrls: ["https://profile.example.invalid/news/"],
        articlePathPrefixes: ["/news/"],
        titleSelector: "h1",
        titleSuffix: "",
        dateSelector: "time",
        dateLabel: "发布时间",
        bodySelector: "article",
        allowQueryUrls: false,
        requestIntervalMs: 1000,
      });
      expect(await f.store.officialWebCollection({})).toMatchObject({
        allTotal: 1,
        configuredTotal: 1,
        readiness: {
          candidateTotal: 1,
          missingProfileTotal: 0,
          policyPendingTotal: 0,
          sourcePendingTotal: 0,
          activeJobTotal: 0,
          readyTotal: 0,
        },
      });
    } finally {
      f.close();
    }
  });
});

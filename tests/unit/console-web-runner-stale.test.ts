import { describe, expect, it } from "vitest";
import {
  consoleV2Fixture,
  sourceInput,
  confirmed,
} from "../fixtures/console-v2";
import { ConsoleSyncStore } from "@/lib/server/console/v2-sync";
import { runCloudWebBatch } from "@/lib/server/console/cloud-web-runner";

const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});

const ORIGIN = "https://xxgk.gdufs.edu.cn";

describe("web runner after a source version bump", () => {
  it("keeps fetching instead of failing every permit", async () => {
    const f = await consoleV2Fixture();
    try {
      const store = new ConsoleSyncStore(f.db, f.actor);
      const created = await store.createGovernedSource(
        sourceInput({ websiteUrl: ORIGIN, governance: confirmed }),
      );
      const id = created.id;
      await store.verifySource(id, {
        ...cmd(created.version),
        status: "verified",
        officialStatus: "verified_official",
        permissionStatus: "approved",
        authorityConfirmed: true,
        note: "隔离环境核验",
        evidenceUrls: [ORIGIN + "/"],
      });
      const verified = await store.sourceV2(id);
      await store.saveWebProfile(id, {
        ...cmd(verified.version),
        configurationStatus: "verified",
        earliestImportDay: "2022-01-01",
        entryUrls: [`${ORIGIN}/xxgkml1/gzzdzc.htm`],
        articlePathPrefixes: ["/info/1203/"],
        titleSelector: "head > title",
        titleSuffix: "",
        dateSelector: "[class^=timestyle]",
        dateLabel: "发布时间",
        bodySelector: ".v_news_content",
        allowQueryUrls: false,
        requestIntervalMs: 0,
      });
      const profiled = await store.sourceV2(id);
      const raw = f.sqlite
        .prepare("SELECT web_profile_json FROM knowledge_sources WHERE id=?")
        .get(id) as { web_profile_json: string };
      await store.setPolicy(id, {
        ...cmd(profiled.version),
        ruleVersion: JSON.parse(raw.web_profile_json).ruleVersion,
        rightsScope: "licensed_full_text",
        fullTextAuthorized: true,
        evidenceUrls: [ORIGIN + "/robots.txt"],
        note: "隔离环境核验",
        robotsStatus: 200,
        robotsHash: null,
        validityDays: 30,
      });
      f.sqlite.exec(
        "UPDATE console_engine_settings SET auto_sync_enabled=0; UPDATE knowledge_sources SET next_sync_at_ms=9999999999999",
      );
      await store.syncNow({ commandId: crypto.randomUUID(), sourceId: id });
      await runCloudWebBatch(f.db, { maxSteps: 1 });

      // Whitelisting bumps the source version; the queued job must survive it.
      const before = await store.sourceV2(id);
      await store.protection({
        ...cmd(before.version),
        type: "source",
        targetId: id,
        active: true,
        historyExempt: true,
        expiresAt: null,
        reason: "长期参考文件白名单",
      });
      const stale = f.sqlite
        .prepare(
          "SELECT j.source_version AS job, s.version AS source FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id WHERE j.source_id=?",
        )
        .get(id) as { job: number; source: number };
      expect(stale.source).toBeGreaterThan(stale.job);

      for (let i = 0; i < 4; i++) await runCloudWebBatch(f.db, { maxSteps: 1 });

      const healed = f.sqlite
        .prepare(
          "SELECT j.source_version AS job, s.version AS source FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id WHERE j.source_id=?",
        )
        .get(id) as { job: number; source: number };
      expect(healed.job).toBe(healed.source);
      const job = f.sqlite
        .prepare(
          "SELECT attempts, body_count FROM ingestion_jobs WHERE source_id=?",
        )
        .get(id) as { attempts: number; body_count: number };
      expect(job.attempts).toBeGreaterThan(1);
      expect(job.body_count).toBeGreaterThan(0);
    } finally {
      f.close();
    }
  }, 300000);
});

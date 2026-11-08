import { expect, it } from "vitest";
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

async function setup(whitelist: boolean) {
  const f = await consoleV2Fixture();
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
  const afterProfile = await store.sourceV2(id);
  const raw = f.sqlite
    .prepare("SELECT web_profile_json FROM knowledge_sources WHERE id=?")
    .get(id) as { web_profile_json: string };
  await store.setPolicy(id, {
    ...cmd(afterProfile.version),
    ruleVersion: JSON.parse(raw.web_profile_json).ruleVersion,
    rightsScope: "licensed_full_text",
    fullTextAuthorized: true,
    evidenceUrls: [ORIGIN + "/robots.txt"],
    note: "隔离环境核验",
    robotsStatus: 200,
    robotsHash: null,
    validityDays: 30,
  });
  if (whitelist) {
    const latest = await store.sourceV2(id);
    await store.protection({
      ...cmd(latest.version),
      type: "source",
      targetId: id,
      active: true,
      historyExempt: true,
      expiresAt: null,
      reason: "长期参考文件白名单",
    });
  }
  f.sqlite
    .prepare(
      "UPDATE console_engine_settings SET earliest_import_day='2026-01-01'",
    )
    .run();
  f.sqlite.exec(
    "UPDATE console_engine_settings SET auto_sync_enabled=0; UPDATE knowledge_sources SET next_sync_at_ms=9999999999999",
  );
  await store.syncNow({ commandId: crypto.randomUUID(), sourceId: id });
  return { f, id };
}

it("whitelisting a source lets pre-cutoff articles through the retention trigger", async () => {
  const blocked = await setup(false);
  try {
    for (let i = 0; i < 3; i++)
      await runCloudWebBatch(blocked.f.db, { maxSteps: 1 });
    const job = blocked.f.sqlite
      .prepare("SELECT body_count FROM ingestion_jobs WHERE source_id=?")
      .get(blocked.id) as { body_count: number };
    expect(job.body_count).toBe(0);
  } finally {
    blocked.f.close();
  }

  const allowed = await setup(true);
  try {
    for (let i = 0; i < 4; i++)
      await runCloudWebBatch(allowed.f.db, { maxSteps: 1 });
    const job = allowed.f.sqlite
      .prepare("SELECT body_count FROM ingestion_jobs WHERE source_id=?")
      .get(allowed.id) as { body_count: number };
    expect(job.body_count).toBeGreaterThan(0);
  } finally {
    allowed.f.close();
  }
}, 300000);

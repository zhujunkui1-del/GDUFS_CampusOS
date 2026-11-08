import { it } from "vitest";
import {
  consoleV2Fixture,
  sourceInput,
  confirmed,
} from "../fixtures/console-v2";
import { ConsoleSyncStore } from "@/lib/server/console/v2-sync";
import { dispatchDue } from "@/lib/server/console/scheduler";
import { runCloudWebBatch } from "@/lib/server/console/cloud-web-runner";

const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});

const ORIGIN = "https://xxgk.gdufs.edu.cn";
const RULE_VERSION = "official-web-2026-11-08.9";
const PROFILE = {
  entryUrls: [
    `${ORIGIN}/xxgkml1/gzzdzc.htm`,
    `${ORIGIN}/xxgkml1/sfgzgl.htm`,
  ],
  articlePathPrefixes: ["/info/1203/"],
  titleSelector: "head > title",
  titleSuffix: "",
  dateSelector: "[class^=timestyle]",
  dateLabel: "发布时间",
  bodySelector: ".v_news_content",
  allowQueryUrls: false,
  requestIntervalMs: 0,
};

it("reproduces the real commit failure", async () => {
  const f = await consoleV2Fixture();
  const store = new ConsoleSyncStore(f.db, f.actor);
  try {
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
      ...PROFILE,
    });
    const afterProfile = await store.sourceV2(id);
    const raw = f.sqlite
      .prepare("SELECT web_profile_json FROM knowledge_sources WHERE id=?")
      .get(id) as { web_profile_json: string };
    console.log("PROFILE_JSON", raw.web_profile_json);
    const actualRule = JSON.parse(raw.web_profile_json).ruleVersion;
    await store.setPolicy(id, {
      ...cmd(afterProfile.version),
      ruleVersion: actualRule,
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
    for (let i = 0; i < 6; i++) {
      const r = await runCloudWebBatch(f.db, { maxSteps: 1 });
      console.log("STEP", i, JSON.stringify(r));
      const job = f.sqlite
        .prepare(
          "SELECT phase,status,attempts,found_count,body_count,error_code,checkpoint_json FROM ingestion_jobs WHERE source_id=?",
        )
        .get(id) as Record<string, unknown> | undefined;
      console.log("  JOB", JSON.stringify(job));
      if (job?.phase === "complete") break;
    }
  } finally {
    f.close();
  }
}, 300000);

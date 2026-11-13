import { it, expect, describe, vi } from "vitest";
import {
  consoleV2Fixture,
  sourceInput,
  confirmed,
} from "../fixtures/console-v2";
import { ConsoleSyncStore, runnerActor } from "@/lib/server/console/v2-sync";
import { dispatchDue } from "@/lib/server/console/scheduler";
import { runCloudWebBatch } from "@/lib/server/console/cloud-web-runner";
import { webProfiles } from "@/lib/ingestion/profiles";
import { ContentInputSchema } from "@/domain/console/contracts";
const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
async function setup() {
  const f = await consoleV2Fixture(),
    store = new ConsoleSyncStore(f.db, f.actor);
  async function source(index = 0) {
    const p = webProfiles[index],
      s = await store.createGovernedSource(
        sourceInput({ websiteUrl: p.origin, governance: confirmed }),
      );
    f.sqlite
      .prepare("UPDATE knowledge_sources SET id=? WHERE id=?")
      .run(p.sourceId, s.id);
    await store.verifySource(p.sourceId, {
      ...cmd(1),
      status: "verified",
      officialStatus: "verified_official",
      permissionStatus: "approved",
      authorityConfirmed: true,
      note: "隔离官网主体核对",
      evidenceUrls: [p.origin + "/"],
    });
    await store.setPolicy(p.sourceId, {
      ...cmd(2),
      ruleVersion: p.ruleVersion,
      rightsScope: "metadata_only",
      evidenceUrls: [p.origin + "/robots.txt"],
      note: "隔离元数据采集许可",
      robotsStatus: 404,
      robotsHash: null,
      validityDays: 30,
    });
    return p.sourceId;
  }
  return { ...f, store, source };
}
describe("V2 persistent scheduling and dual executors", () => {
  it("queues a manual check without a local runner and despite a future due date or paused automatic sync", async () => {
    const f = await setup();
    try {
      const id = await f.source(),
        commandId = crypto.randomUUID();
      f.sqlite.exec(
        "UPDATE console_engine_settings SET auto_sync_enabled=0; UPDATE knowledge_sources SET next_sync_at_ms=9999999999999",
      );
      expect(await f.store.syncNow({ commandId, sourceId: id })).toMatchObject({
        state: "registered",
        registered: 1,
        completed: 0,
      });
      expect(await f.store.syncNow({ commandId, sourceId: id })).toMatchObject({
        registered: 0,
      });
      expect(
        f.sqlite.prepare("SELECT count(*) n FROM ingestion_jobs").get()?.n,
      ).toBe(1);
    } finally {
      f.close();
    }
  });
  it("registers one global manual run across every eligible official website", async () => {
    const f = await setup();
    try {
      await f.source(0);
      await f.source(1);
      f.sqlite.exec(
        "UPDATE console_engine_settings SET auto_sync_enabled=0; UPDATE knowledge_sources SET next_sync_at_ms=9999999999999",
      );

      expect(
        await f.store.syncNow({ commandId: crypto.randomUUID() }),
      ).toMatchObject({
        state: "registered",
        registered: 2,
        completed: 0,
      });
      expect(
        f.sqlite.prepare("SELECT count(*) n FROM ingestion_jobs").get()?.n,
      ).toBe(2);
      // A second click is a new command id, so it must not queue a second run
      // for every source that the first click already queued.
      expect(
        await f.store.syncNow({ commandId: crypto.randomUUID() }),
      ).toMatchObject({
        state: "no_eligible_due_source",
        registered: 0,
      });
      expect(
        f.sqlite.prepare("SELECT count(*) n FROM ingestion_jobs").get()?.n,
      ).toBe(2);
    } finally {
      f.close();
    }
  });
  it("collects every enabled official website with a confirmed entry profile, review labels are not gates", async () => {
    const f = await setup();
    try {
      const readyId = await f.source(0),
        unverifiedSourceId = await f.source(1),
        candidateEntryId = await f.source(2),
        candidateProfile = webProfiles.find(
          (profile) => profile.sourceId === candidateEntryId,
        )!;
      f.sqlite
        .prepare(
          "UPDATE knowledge_sources SET verification_status='pending' WHERE id=?",
        )
        .run(unverifiedSourceId);
      f.sqlite
        .prepare(
          "UPDATE knowledge_sources SET permission_status='unreviewed' WHERE id=?",
        )
        .run(readyId);
      f.sqlite
        .prepare("UPDATE knowledge_sources SET web_profile_json=? WHERE id=?")
        .run(
          JSON.stringify({
            ruleVersion: candidateProfile.ruleVersion,
            configurationStatus: "discovered",
            entryUrls: [candidateProfile.entryUrl],
            articlePathPrefixes: candidateProfile.detailPathPrefixes,
            titleSelector: candidateProfile.titleSelector,
            titleSuffix: candidateProfile.titleSuffix,
            dateSelector: candidateProfile.dateSelector,
            dateLabel: candidateProfile.dateLabel,
            bodySelector: candidateProfile.bodySelector,
            allowQueryUrls: false,
            requestIntervalMs: 0,
          }),
          candidateEntryId,
        );

      expect(
        await f.store.syncNow({ commandId: crypto.randomUUID() }),
      ).toMatchObject({
        state: "registered",
        registered: 2,
        completed: 0,
      });
      // A review label that was never ticked used to park a fully configured
      // site forever; only a draft entry profile still keeps a source out.
      expect(
        f.sqlite
          .prepare("SELECT source_id FROM ingestion_jobs ORDER BY source_id")
          .all()
          .map((job) => job.source_id),
      ).toEqual([readyId, unverifiedSourceId].sort());
    } finally {
      f.close();
    }
  });
  it("automatically publishes a fetched official website article without a human review", async () => {
    const f = await setup();
    try {
      const id = await f.source(0),
        profile = webProfiles.find((item) => item.sourceId === id)!,
        current = await f.store.sourceV2(id);
      await f.store.setPolicy(id, {
        ...cmd(current.version),
        ruleVersion: profile.ruleVersion,
        rightsScope: "licensed_full_text",
        fullTextAuthorized: true,
        evidenceUrls: [profile.origin + "/robots.txt"],
        note: "隔离正文采集策略",
        robotsStatus: 404,
        robotsHash: null,
        validityDays: 30,
      });
      f.sqlite
        .prepare(
          "UPDATE knowledge_sources SET permission_status='unreviewed' WHERE id=?",
        )
        .run(id);
      await f.store.syncNow({
        commandId: crypto.randomUUID(),
        sourceId: id,
      });
      const jobId = String(
        f.sqlite.prepare("SELECT id FROM ingestion_jobs").get()?.id,
      );
      let job = await f.store.job(jobId),
        lease = await f.store.claim(jobId, cmd(Number(job.version)));
      const articleUrl = profile.detailPathPrefixes![0] + "999123.htm",
        absoluteArticleUrl = profile.origin + articleUrl;
      await f.store.commit(jobId, {
        ...cmd(lease.version),
        leaseToken: lease.leaseToken,
        fence: lease.fence,
        url: lease.url,
        status: 200,
        bytes: 120,
        requests: 1,
        outcome: "ok",
        etag: null,
        lastModified: null,
        bodyHash: null,
        publishedRaw: null,
        discovered: [absoluteArticleUrl],
        discoveredDates: [
          { url: absoluteArticleUrl, publishedAt: "2026-10-24" },
        ],
      });
      job = await f.store.job(jobId);
      lease = await f.store.claim(jobId, cmd(Number(job.version)));
      // Already captured articles must not be held back by source review labels.
      f.sqlite
        .prepare(
          "UPDATE knowledge_sources SET verification_status='candidate',official_status='claimed_official' WHERE id=?",
        )
        .run(id);
      const article = ContentInputSchema.parse({
        sourceId: id,
        title: "官网自动发布测试",
        url: absoluteArticleUrl,
        body: "<article><p>官网文章正文</p></article>",
        bodyFormat: "reading_html",
        bodyStatus: "complete",
        kind: "knowledge",
        campusScope: "all",
        validUntil: null,
        publishedAt: "2026-10-24",
        sourceUpdatedAt: null,
        contentType: "notice",
        rightsScope: "licensed_full_text",
        radarCategory: null,
        knowledgeCategory: "campus_life",
        publisher: null,
        summary: "官网文章摘要",
        tags: [],
        extractedFields: {},
      });
      await f.store.commit(jobId, {
        ...cmd(lease.version),
        leaseToken: lease.leaseToken,
        fence: lease.fence,
        url: lease.url,
        status: 200,
        bytes: 120,
        requests: 1,
        outcome: "ok",
        etag: null,
        lastModified: null,
        bodyHash: "a".repeat(64),
        publishedRaw: "2026-10-24",
        article,
        bodyTextChars: 6,
      });

      expect(
        f.sqlite
          .prepare(
            "SELECT review_status,workflow_status,publication_status FROM knowledge_documents WHERE url=?",
          )
          .get(absoluteArticleUrl),
      ).toMatchObject({
        review_status: "approved",
        workflow_status: "approved",
        publication_status: "published",
      });
      expect(
        f.sqlite
          .prepare(
            "SELECT last_publication_mode FROM console_document_controls WHERE document_id=(SELECT id FROM knowledge_documents WHERE url=?)",
          )
          .get(absoluteArticleUrl),
      ).toMatchObject({ last_publication_mode: "auto" });
      expect(
        f.sqlite
          .prepare(
            "SELECT count(*) AS n FROM console_public_documents WHERE url=?",
          )
          .get(absoluteArticleUrl),
      ).toMatchObject({ n: 1 });
      expect(
        f.sqlite
          .prepare(
            "SELECT count(*) AS n FROM console_commands WHERE action='document.review'",
          )
          .get(),
      ).toMatchObject({ n: 0 });
      const documentId = String(
        f.sqlite
          .prepare("SELECT id FROM knowledge_documents WHERE url=?")
          .get(absoluteArticleUrl)?.id,
      );
      f.sqlite
        .prepare(
          "UPDATE knowledge_documents SET publication_status='draft' WHERE id=?",
        )
        .run(documentId);
      expect(
        await f.store.publishCollectedWebArticle(documentId),
      ).toMatchObject({ published: true });
      expect(
        await f.store.publishCollectedWebArticle(documentId),
      ).toMatchObject({ published: true });
      f.sqlite
        .prepare(
          "UPDATE knowledge_sources SET verification_status='pending' WHERE id=?",
        )
        .run(id);
      expect(
        f.sqlite
          .prepare(
            "SELECT count(*) AS n FROM console_public_documents WHERE url=?",
          )
          .get(absoluteArticleUrl),
      ).toMatchObject({ n: 1 });
      const publishedDocument = await f.store.document(documentId);
      await f.store.publish(
        documentId,
        { ...cmd(publishedDocument.version), note: "管理员主动下架" },
        true,
      );
      expect(
        await f.store.publishCollectedWebArticle(documentId),
      ).toMatchObject({ published: false });
      f.sqlite
        .prepare("UPDATE knowledge_sources SET enabled=0 WHERE id=?")
        .run(id);
      expect(
        f.sqlite
          .prepare(
            "SELECT count(*) AS n FROM console_public_documents WHERE url=?",
          )
          .get(absoluteArticleUrl),
      ).toMatchObject({ n: 0 });
    } finally {
      f.close();
    }
  });
  it("keeps source progress stable between pages and schedules the next run from completion", async () => {
    const f = await setup();
    try {
      const id = await f.source(),
        oldSuccess = new Date(Date.now() - 86400000).toISOString();
      f.sqlite
        .prepare("UPDATE knowledge_sources SET last_success_at=? WHERE id=?")
        .run(oldSuccess, id);
      f.sqlite.exec(`CREATE TABLE source_progress_writes (id TEXT);
        CREATE TRIGGER count_source_progress AFTER UPDATE OF sync_state,last_checked_at,last_success_at,last_executor ON knowledge_sources
        BEGIN INSERT INTO source_progress_writes VALUES(NEW.id); END;`);
      await f.store.syncNow({ commandId: crypto.randomUUID(), sourceId: id });
      const jobId = String(
        f.sqlite.prepare("SELECT id FROM ingestion_jobs").get()?.id,
      );
      const progress = () =>
        f.sqlite
          .prepare("SELECT count(*) AS n FROM source_progress_writes")
          .get()?.n;
      let job = await f.store.job(jobId);
      let lease = await f.store.claim(jobId, cmd(Number(job.version)));
      const claimedWrites = progress();
      await f.store.commit(jobId, {
        ...cmd(lease.version),
        leaseToken: lease.leaseToken,
        fence: lease.fence,
        url: lease.url,
        status: 200,
        bytes: 50,
        requests: 1,
        outcome: "ok",
        etag: null,
        lastModified: null,
        bodyHash: null,
        publishedRaw: null,
        discovered: [],
        nextPage: lease.url.replace(/\.htm$/, "/2.htm"),
      });
      // Use a same-origin allowed list page explicitly in the checkpoint.
      expect(progress()).toBe(claimedWrites);
      expect(
        f.sqlite
          .prepare(
            "SELECT sync_state,last_success_at FROM knowledge_sources WHERE id=?",
          )
          .get(id),
      ).toMatchObject({ sync_state: "running", last_success_at: oldSuccess });
      job = await f.store.job(jobId);
      lease = await f.store.claim(jobId, cmd(Number(job.version)));
      expect(progress()).toBe(claimedWrites);
      // Simulate a long run whose original registration time is already due.
      f.sqlite
        .prepare("UPDATE knowledge_sources SET next_sync_at_ms=1 WHERE id=?")
        .run(id);
      const completedAt = new Date().toISOString();
      const finishingStore = new ConsoleSyncStore(
        f.db,
        f.actor,
        () => completedAt,
      );
      const payload = {
        ...cmd(lease.version),
        leaseToken: lease.leaseToken,
        fence: lease.fence,
        url: lease.url,
        status: 200,
        bytes: 50,
        requests: 1,
        outcome: "ok",
        etag: null,
        lastModified: null,
        bodyHash: null,
        publishedRaw: null,
        discovered: [],
      };
      await finishingStore.commit(jobId, payload);
      const source = f.sqlite
        .prepare(
          "SELECT sync_state,last_success_at,next_sync_at_ms FROM knowledge_sources WHERE id=?",
        )
        .get(id);
      const hours = Number(
        f.sqlite.prepare("SELECT sync_hours FROM console_engine_settings").get()
          ?.sync_hours,
      );
      expect(source).toMatchObject({
        sync_state: "completed",
        last_success_at: completedAt,
        next_sync_at_ms: Date.parse(completedAt) + hours * 3600000,
      });
      expect(progress()).toBe(Number(claimedWrites) + 1);
      await finishingStore.commit(jobId, payload);
      expect(progress()).toBe(Number(claimedWrites) + 1);
      expect(
        (await dispatchDue(f.db, { now: Date.parse(completedAt) + 1000 }))
          .registered,
      ).toBe(0);
    } finally {
      f.close();
    }
  });
  it("registers due tasks, records registration separately from completion, prevents duplicates and honors pause", async () => {
    const f = await setup();
    try {
      const id = await f.source();
      expect(await dispatchDue(f.db)).toMatchObject({
        state: "registered",
        registered: 1,
        completed: 0,
      });
      expect(await dispatchDue(f.db)).toMatchObject({
        registered: 0,
        completed: 0,
      });
      expect(
        f.sqlite
          .prepare("SELECT sync_state FROM knowledge_sources WHERE id=?")
          .get(id)?.sync_state,
      ).toBe("queued");
      f.sqlite.exec(
        "UPDATE ingestion_jobs SET phase='complete',status='completed';UPDATE console_engine_settings SET auto_sync_enabled=0",
      );
      expect(await dispatchDue(f.db)).toMatchObject({
        state: "paused",
        registered: 0,
      });
      expect(
        f.sqlite
          .prepare(
            "SELECT count(*) n FROM console_audit_logs WHERE actor_id='sys-console-scheduler'",
          )
          .get()?.n,
      ).toBe(1);
    } finally {
      f.close();
    }
  });
  it("runs a registered step in the cloud worker using the shared D1 lease", async () => {
    const f = await setup();
    const originalFetch = globalThis.fetch;
    try {
      const id = await f.source(),
        profile = webProfiles.find((item) => item.sourceId === id)!,
        detailPath = profile.detailPathPrefixes![0] + "999001.htm";
      f.sqlite
        .prepare("UPDATE knowledge_sources SET web_profile_json=? WHERE id=?")
        .run(
          JSON.stringify({
            ruleVersion: profile.ruleVersion,
            entryUrls: [profile.entryUrl],
            articlePathPrefixes: profile.detailPathPrefixes,
            titleSelector: profile.titleSelector,
            titleSuffix: profile.titleSuffix,
            dateSelector: profile.dateSelector,
            dateLabel: profile.dateLabel,
            bodySelector: profile.bodySelector,
            allowQueryUrls: false,
            requestIntervalMs: 0,
          }),
          id,
        );
      await dispatchDue(f.db);
      vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname === "/robots.txt")
          return new Response("", { status: 404 });
        return new Response(
          `<html><head><title>校内通知</title></head><body><ul><li><a href="${detailPath}">隔离通知</a>2026-10-23</li></ul></body></html>`,
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        );
      });
      expect(await runCloudWebBatch(f.db, { maxSteps: 1 })).toMatchObject({
        processed: 1,
        results: [
          { jobId: expect.any(String), phase: "discover", outcome: "ok" },
        ],
      });
      expect(
        f.sqlite
          .prepare("SELECT phase,status FROM ingestion_jobs WHERE source_id=?")
          .get(id),
      ).toMatchObject({ phase: "fetch", status: "queued" });
      expect(
        f.sqlite
          .prepare("SELECT last_executor FROM knowledge_sources WHERE id=?")
          .get(id),
      ).toMatchObject({ last_executor: "cloud" });
    } finally {
      globalThis.fetch = originalFetch;
      f.close();
    }
  });
  it("registers custom sources with multiple article paths through the shared scheduler", async () => {
    const f = await setup();
    try {
      const created = await f.store.createGovernedSource(
        sourceInput({
          displayName: "隔离动态官网",
          websiteUrl: "https://dynamic.example.edu/",
          governance: confirmed,
        }),
      );
      const sourceId = created.id;
      await f.store.verifySource(sourceId, {
        ...cmd(created.version),
        status: "verified",
        officialStatus: "verified_official",
        permissionStatus: "approved",
        authorityConfirmed: true,
        note: "隔离官网核验",
        evidenceUrls: ["https://dynamic.example.edu/"],
      });
      const verified = await f.store.sourceV2(sourceId);
      await f.store.saveWebProfile(sourceId, {
        ...cmd(verified.version),
        configurationStatus: "discovered",
        entryUrls: [
          "https://dynamic.example.edu/news/",
          "https://dynamic.example.edu/notices/",
        ],
        articlePathPrefixes: ["/news/detail/", "/notices/article/"],
        titleSelector: "h1, title",
        titleSuffix: "",
        dateSelector: "time, .date",
        dateLabel: "发布时间",
        bodySelector: "article, main",
        allowQueryUrls: false,
        requestIntervalMs: 0,
      });
      const candidate = await f.store.policy(sourceId),
        current = await f.store.sourceV2(sourceId);
      expect(candidate.profile.entryUrls).toHaveLength(2);
      expect(candidate.profile.configurationStatus).toBe("discovered");
      await f.store.setPolicy(sourceId, {
        ...cmd(current.version),
        ruleVersion: candidate.profile.ruleVersion,
        rightsScope: "metadata_only",
        evidenceUrls: ["https://dynamic.example.edu/robots.txt"],
        note: "隔离元数据采集许可",
        robotsStatus: 404,
        robotsHash: null,
        validityDays: 30,
      });
      expect(await dispatchDue(f.db)).toMatchObject({
        state: "no_eligible_due_source",
        registered: 0,
      });
      const candidateSource = await f.store.sourceV2(sourceId);
      await f.store.saveWebProfile(sourceId, {
        ...cmd(candidateSource.version),
        configurationStatus: "verified",
        entryUrls: [
          "https://dynamic.example.edu/news/",
          "https://dynamic.example.edu/notices/",
        ],
        articlePathPrefixes: ["/news/detail/", "/notices/article/"],
        titleSelector: "h1, title",
        titleSuffix: "",
        dateSelector: "time, .date",
        dateLabel: "发布时间",
        bodySelector: "article, main",
        allowQueryUrls: false,
        requestIntervalMs: 0,
      });
      const configured = await f.store.policy(sourceId),
        reviewed = await f.store.sourceV2(sourceId);
      expect(configured.profile.configurationStatus).toBe("verified");
      await f.store.setPolicy(sourceId, {
        ...cmd(reviewed.version),
        ruleVersion: configured.profile.ruleVersion,
        rightsScope: "metadata_only",
        evidenceUrls: ["https://dynamic.example.edu/robots.txt"],
        note: "隔离元数据采集许可复核",
        robotsStatus: 404,
        robotsHash: null,
        validityDays: 30,
      });
      expect(await dispatchDue(f.db)).toMatchObject({
        state: "registered",
        registered: 1,
      });
      expect(
        f.sqlite
          .prepare("SELECT source_id FROM ingestion_jobs WHERE source_id=?")
          .get(sourceId),
      ).toMatchObject({ source_id: sourceId });
    } finally {
      f.close();
    }
  });
  it("uses global cadence, current permission and lease; source overrides are rejected", async () => {
    const f = await setup();
    try {
      const id = await f.source();
      f.sqlite
        .prepare(
          "UPDATE console_engine_settings SET scheduler_lease_until_ms=?",
        )
        .run(Date.now() + 30000);
      expect(await dispatchDue(f.db)).toMatchObject({ state: "busy" });
      f.sqlite.exec(
        "UPDATE console_engine_settings SET scheduler_lease_until_ms=0",
      );
      f.sqlite
        .prepare(
          "UPDATE knowledge_sources SET last_success_at=?,next_sync_at_ms=?,sync_policy_version=(SELECT sync_revision FROM console_engine_settings WHERE id='console-v2-settings'),sync_hours_override=1 WHERE id=?",
        )
        .run(
          new Date(Date.now() - 2 * 3600000).toISOString(),
          Date.now() - 3600000,
          id,
        );
      expect((await dispatchDue(f.db)).registered).toBe(0);
      await expect(
        f.store.saveSourceSync(id, {
          ...cmd(3),
          hours: 1,
          note: "隔离单站一小时更新",
        }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      const settings = await f.store.engineSettings();
      await f.store.saveEngineSettings({
        ...cmd(Number(settings?.version || 1)),
        syncHours: 1,
        autoSync: true,
        earliestImportDay: settings?.earliest_import_day || null,
        note: "隔离官网统一一小时间隔",
      });
      expect((await dispatchDue(f.db)).registered).toBe(1);
      const scheduledSource = await f.store.sourceV2(id);
      await f.store.enableSource(id, {
        ...cmd(scheduledSource.version),
        enabled: false,
      });
      expect((await dispatchDue(f.db)).registered).toBe(0);
      expect(
        f.sqlite.prepare("SELECT control_state FROM ingestion_jobs").get()
          ?.control_state,
      ).toBe("paused");
      await expect(
        f.store.saveSourceSync(id, { ...cmd(5), hours: 25, note: "非法周期" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    } finally {
      f.close();
    }
  });
  it("scoped runner cannot claim another source or continue after revocation; permit rechecks pause", async () => {
    const f = await setup();
    try {
      const id = await f.source(),
        other = await f.source(1);
      await dispatchDue(f.db);
      const jobs = f.sqlite
        .prepare(
          "SELECT id,source_id,version FROM ingestion_jobs ORDER BY source_id",
        )
        .all();
      const token = await f.store.createRunnerToken({
        ...cmd(1),
        label: "隔离执行器",
        sourceIds: [id],
        validityDays: 1,
      });
      expect(token.token).toHaveLength(43);
      const runner = new ConsoleSyncStore(f.db, runnerActor);
      runner.runnerId = token.id;
      const own = jobs.find((j) => j.source_id === id)!,
        foreign = jobs.find((j) => j.source_id === other)!;
      await expect(
        runner.claim(String(foreign.id), cmd(Number(foreign.version))),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const lease = await runner.claim(
        String(own.id),
        cmd(Number(own.version)),
      );
      expect(
        await runner.permit(lease.id, {
          leaseToken: lease.leaseToken,
          fence: lease.fence,
          version: lease.version,
        }),
      ).toMatchObject({ permitted: true });
      await f.store.enableSource(id, { ...cmd(3), enabled: false });
      await expect(
        runner.permit(lease.id, {
          leaseToken: lease.leaseToken,
          fence: lease.fence,
          version: lease.version,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await f.store.revokeRunnerToken(token.id, cmd(2));
      const revokedJob = await runner.job(lease.id);
      await expect(
        runner.control(lease.id, cmd(Number(revokedJob.version)), "cancel"),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        f.sqlite
          .prepare("SELECT revoked_at_ms FROM console_runner_tokens")
          .get()?.revoked_at_ms,
      ).toBeGreaterThan(0);
    } finally {
      f.close();
    }
  });
  it("requires explicit source assignment for human operators", async () => {
    const f = await setup();
    try {
      const id = await f.source();
      f.sqlite.exec(
        "INSERT INTO console_admins(id,email,role) VALUES('ops','ops@example.invalid','operator')",
      );
      const ops = new ConsoleSyncStore(f.db, {
        id: "ops",
        email: "ops@example.invalid",
        role: "operator",
      });
      await expect(
        ops.enableSource(id, { ...cmd(3), enabled: false }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await f.store.assignOperator(id, {
        ...cmd(3),
        operatorId: "ops",
        enabled: true,
      });
      await ops.enableSource(id, { ...cmd(4), enabled: false });
      expect((await f.store.sourceV2(id)).enabled).toBe(false);
    } finally {
      f.close();
    }
  });
  it("filters real dashboard counters by source and first-recorded dates rather than refetch time", async () => {
    const f = await setup();
    try {
      const id = await f.source();
      f.sqlite
        .prepare(
          "INSERT INTO knowledge_documents(id,source_id,title,url,body,content_hash,fetched_at,campus_scope,data_domain,published_at) VALUES('old',?,'isolated','https://example.invalid/doc','text','hash',?,'all','campus_announcements','2019-01-01')",
        )
        .run(id, new Date().toISOString());
      f.sqlite
        .prepare(
          "INSERT INTO console_content_versions(document_id,version,snapshot_json,created_by,created_at) VALUES('old',1,'{}',?,'2020-01-01')",
        )
        .run(f.actor.id);
      const sourceList = await f.store.sourcesV2({});
      expect(sourceList.items.find((source) => source.id === id)).toMatchObject(
        {
          articleCount: 1,
          publishedCount: 0,
        },
      );
      expect(
        (await f.store.dashboard({ from: "2020-01-01", to: "2020-01-02" }))
          .stats.todayNew,
      ).toBe(1);
      expect((await f.store.dashboard({})).stats.todayNew).toBe(0);
      expect(
        (await f.store.dashboard({ q: "does-not-exist" })).stats.sources,
      ).toBe(0);
      await expect(
        f.store.dashboard({ from: "2026-12-01", to: "2026-01-01" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    } finally {
      f.close();
    }
  });
  it("removes the global daily job budget while leaving unconfigured sources out of the queue", async () => {
    const f = await setup();
    try {
      await f.store.createGovernedSource(
        sourceInput({ governance: confirmed }),
      );
      expect((await dispatchDue(f.db)).registered).toBe(0);
      const id = await f.source();
      f.sqlite.exec("UPDATE console_engine_settings SET network_budget=2");
      for (let index = 0; index < 12; index++) {
        const job = await f.store.createJob({
          commandId: crypto.randomUUID(),
          sourceId: id,
          maxArticles: 2,
          mode: "incremental",
        });
        f.sqlite
          .prepare(
            "UPDATE ingestion_jobs SET phase='complete',status='completed',control_state='active',lease_hash=NULL,lease_until_ms=0 WHERE id=?",
          )
          .run(job.id);
      }
      expect(
        f.sqlite
          .prepare("SELECT count(*) AS n FROM ingestion_jobs WHERE source_id=?")
          .get(id)?.n,
      ).toBe(12);
    } finally {
      f.close();
    }
  });
});

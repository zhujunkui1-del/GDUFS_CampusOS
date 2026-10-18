import { it, expect, describe } from "vitest";
import {
  consoleV2Fixture,
  sourceInput,
  confirmed,
} from "../fixtures/console-v2";
import { ConsoleSyncStore, runnerActor } from "@/lib/server/console/v2-sync";
import { dispatchDue } from "@/lib/server/console/scheduler";
import { webProfiles } from "@/lib/ingestion/profiles";
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
describe("V2 bounded persistent scheduling and scoped runners", () => {
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
  it("uses global/override cadence, current permission and lease; >24h remains forbidden", async () => {
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
        "UPDATE console_engine_settings SET scheduler_lease_until_ms=0;UPDATE knowledge_sources SET next_sync_at_ms=9999999999999,sync_policy_version=1",
      );
      expect((await dispatchDue(f.db)).registered).toBe(0);
      await f.store.saveSourceSync(id, {
        ...cmd(3),
        hours: 1,
        note: "隔离单源一小时更新",
      });
      expect((await dispatchDue(f.db)).registered).toBe(1);
      await f.store.enableSource(id, { ...cmd(4), enabled: false });
      expect((await dispatchDue(f.db)).registered).toBe(0);
      expect(
        f.sqlite.prepare("SELECT control_state FROM ingestion_jobs").get()
          ?.control_state,
      ).toBe("paused");
      await expect(
        f.store.saveSourceSync(id, { ...cmd(5), hours: 25, note: "非法周期" }),
      ).rejects.toThrow();
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
  it("preserves the global network hard budget and never schedules unsupported/manual sources", async () => {
    const f = await setup();
    try {
      await f.store.createGovernedSource(
        sourceInput({ governance: confirmed }),
      );
      expect((await dispatchDue(f.db)).registered).toBe(0);
      const id = await f.source();
      await dispatchDue(f.db);
      f.sqlite.exec("UPDATE console_engine_settings SET network_budget=2");
      const job = f.sqlite
        .prepare("SELECT * FROM ingestion_jobs WHERE source_id=?")
        .get(id)!;
      await f.store.claim(String(job.id), cmd(Number(job.version)));
      expect(await dispatchDue(f.db)).toMatchObject({
        state: "budget_exhausted",
        registered: 0,
      });
    } finally {
      f.close();
    }
  });
});

import type { SqlDatabase } from "../assistant/database";
import { profileFromSource, webProfiles } from "@/lib/ingestion/profiles";
type Due = {
  id: string;
  version: number;
  policy_version: number | null;
  rule_version: string | null;
  display_name: string;
  website_url: string | null;
  web_profile_json: string | null;
  hours: number;
  next_sync_at_ms: number | null;
  sync_revision: number;
};
// Task registration is separate from execution. Both the cloud Worker and the
// local Node runner may claim work; D1 leases ensure only one executor owns a job.
// Registration writes three statements per source, so they are grouped into
// batches of this many sources to stay well inside D1's statement budget.
const REGISTRATION_CHUNK = 20;
// A manual "collect now" click must not queue a second run for a source that
// was queued moments ago, otherwise impatient double clicks quadruple the
// queue and starve the sources nobody clicked twice.
const MANUAL_COOLDOWN_MS = 10 * 60 * 1000;
export async function dispatchDue(
  db: SqlDatabase,
  options: {
    now?: number;
    sourceId?: string;
    allowedIds?: string[];
    manualId?: string;
    limit?: number;
  } = {},
) {
  const now = options.now || Date.now(),
    limit = Math.max(1, Math.floor(options.limit ?? 50)),
    manualRun = !!options.manualId,
    stamp = new Date(now).toISOString(),
    lease = crypto.randomUUID();
  const locked = await db
    .prepare(
      "UPDATE console_engine_settings SET scheduler_lease_until_ms=?,scheduler_lease_token=? WHERE id='console-v2-settings' AND scheduler_lease_until_ms<=?",
    )
    .bind(now + 30000, lease, now)
    .run();
  if (!locked.meta.changes) {
    // Another registration holds the lease. Report how long it has left so the
    // client can wait it out instead of giving up after two short retries.
    const held = await db
      .prepare(
        "SELECT scheduler_lease_until_ms FROM console_engine_settings WHERE id='console-v2-settings'",
      )
      .first<{ scheduler_lease_until_ms: number }>();
    return {
      state: "busy",
      registered: 0,
      completed: 0,
      retryAfterMs: Math.min(
        8000,
        Math.max(1200, Number(held?.scheduler_lease_until_ms || 0) - now),
      ),
    };
  }
  let result: {
    state: string;
    registered: number;
    completed: number;
    reason?: string;
    detail?: string;
  } = { state: "idle", registered: 0, completed: 0 };
  try {
    const settings = await db
      .prepare(
        "SELECT auto_sync_enabled FROM console_engine_settings WHERE id='console-v2-settings'",
      )
      .first<{ auto_sync_enabled: number }>();
    if (!settings?.auto_sync_enabled && !options.manualId) {
      result.state = "paused";
      return result;
    }
    // Only a real change to the source itself invalidates a queued job. The
    // review labels (verification, permission, policy expiry) used to be part
    // of this test as well, which meant a job could be parked a tick after it
    // was registered simply because an unrelated label had not been ticked.
    const stale = await db
      .prepare(
        "SELECT j.id,j.source_id,j.version FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id LEFT JOIN source_collection_policies p ON p.source_id=s.id WHERE j.job_kind='web' AND j.run_key NOT LIKE 'manual:%' AND j.control_state='active' AND j.phase<>'complete' AND (j.source_version<>s.version OR (p.source_id IS NOT NULL AND j.policy_version<>p.version) OR s.enabled=0 OR s.archived_at IS NOT NULL OR s.operating_status='closed') ORDER BY j.created_at,j.id LIMIT 50",
      )
      .all<{ id: string; source_id: string; version: number }>();
    for (let i = 0; i < stale.results.length; i += REGISTRATION_CHUNK) {
      const statements = [];
      for (const j of stale.results.slice(i, i + REGISTRATION_CHUNK)) {
        statements.push(
          db
            .prepare(
              "INSERT INTO console_commands(id,admin_id,action,target_type,target_id,source_id,expected_version,request_hash,details_json) VALUES(?,'sys-console-scheduler','job.pause','job',?,?,?,?,?)",
            )
            .bind(
              crypto.randomUUID(),
              j.id,
              j.source_id,
              j.version,
              "stale:" + j.id + ":" + j.version,
              JSON.stringify({
                v2: 1,
                schedulerLease: lease,
                note: "来源或许可变化，隔离旧任务",
              }),
            ),
          db
            .prepare(
              "UPDATE ingestion_jobs SET control_state='paused',error_code='STALE_SOURCE_OR_POLICY',lease_hash=NULL,lease_until_ms=0,lease_fence=lease_fence+1,version=version+1,updated_at=? WHERE id=?",
            )
            .bind(stamp, j.id),
        );
      }
      await db.batch(statements);
    }
    const staticIds = webProfiles.map((p) => p.sourceId),
      allowedIds = options.allowedIds,
      profileSql = `(s.web_profile_json<>'{}' OR s.id IN(${staticIds
        .map(() => "?")
        .join(",")}))`,
      scopeSql = allowedIds
        ? ` AND s.id IN(${allowedIds.map(() => "?").join(",")})`
        : "",
      where = options.sourceId ? " AND s.id=?" : "";
    const rows = await db
      .prepare(
        `SELECT s.id,s.display_name,s.website_url,s.web_profile_json,s.version,p.version AS policy_version,p.rule_version,e.sync_hours hours,s.next_sync_at_ms,e.sync_revision FROM knowledge_sources s LEFT JOIN source_collection_policies p ON p.source_id=s.id CROSS JOIN console_engine_settings e WHERE s.console_managed=1 AND s.source_type='official_web' AND s.channel_type='official_web' AND ${profileSql}${scopeSql} AND s.enabled=1 AND s.archived_at IS NULL AND s.operating_status<>'closed' AND s.sync_state<>'blocked'${where}
 AND (?=1 OR (CASE WHEN s.sync_hours_override IS NOT NULL OR (s.sync_policy_version>0 AND s.sync_policy_version<>e.sync_revision) THEN COALESCE(CAST((julianday(s.last_success_at)-2440587.5)*86400000 AS INTEGER),0)+e.sync_hours*3600000 ELSE COALESCE(s.next_sync_at_ms,0) END)<=?)
 AND NOT EXISTS(SELECT 1 FROM ingestion_jobs j WHERE j.source_id=s.id AND j.control_state='active' AND j.phase<>'complete' AND j.status IN('queued','running')) ORDER BY COALESCE(s.next_sync_at_ms,0),s.id LIMIT ?`,
      )
      .bind(
        ...staticIds,
        ...(allowedIds || []),
        ...(options.sourceId ? [options.sourceId] : []),
        Number(!!options.manualId),
        now,
        limit,
      )
      .all<Due>();
    const pending: {
      id: string;
      commandId: string;
      sourceId: string;
      runKey: string;
      ruleVersion: string;
      version: number;
      policyVersion: number;
      hours: number;
      syncRevision: number;
    }[] = [];
    for (const s of rows.results) {
      let profile: ReturnType<typeof profileFromSource> = null;
      try {
        profile = profileFromSource({
          sourceId: s.id,
          name: s.display_name,
          websiteUrl: s.website_url,
          webProfileJson: s.web_profile_json || "{}",
        });
      } catch {
        profile = null;
      }
      // A source is collectable once its entry profile is configured. The old
      // check also demanded that the profile and the collection policy carried
      // the same rule version, so a freshly configured site silently never
      // ran until someone re-ticked it elsewhere.
      if (!profile || profile.configurationStatus === "discovered") continue;
      const commandId =
        (options.sourceId && options.manualId) || crypto.randomUUID();
      pending.push({
        id: "job-" + commandId,
        commandId,
        sourceId: s.id,
        runKey: manualRun
          ? `manual:${s.id}:${options.manualId}`
          : `scheduled:${s.id}:${s.version}:${s.next_sync_at_ms || 0}`,
        ruleVersion: s.rule_version || profile.ruleVersion,
        version: s.version,
        policyVersion: s.policy_version ?? 0,
        hours: s.hours,
        syncRevision: s.sync_revision,
      });
    }
    if (!pending.length) {
      result.state = "no_eligible_due_source";
      return result;
    }
    // Registration used to cost two D1 round trips per source — close to two
    // hundred for a full sweep, which regularly ran past the console's
    // fifteen second request timeout and looked like a broken button. One
    // lookup for every candidate key plus one batch per chunk keeps a sweep
    // at a few round trips.
    const keys = pending.map((p) => p.runKey);
    const taken = new Set(
      (
        await db
          .prepare(
            `SELECT run_key FROM ingestion_jobs WHERE run_key IN(${keys
              .map(() => "?")
              .join(",")})`,
          )
          .bind(...keys)
          .all<{ run_key: string }>()
      ).results.map((r) => r.run_key),
    );
    // Clicking "collect now" twice while the first request is still in flight
    // used to register a second full batch for every source that had already
    // finished its first job.
    const cooled = new Set<string>();
    if (manualRun) {
      const recent = await db
        .prepare(
          "SELECT DISTINCT source_id FROM ingestion_jobs WHERE run_key LIKE 'manual:%' AND created_at>=?",
        )
        .bind(new Date(now - MANUAL_COOLDOWN_MS).toISOString())
        .all<{ source_id: string }>();
      for (const r of recent.results) cooled.add(r.source_id);
    }
    const fresh = pending.filter(
      (p) => !taken.has(p.runKey) && !cooled.has(p.sourceId),
    );
    for (let i = 0; i < fresh.length; i += REGISTRATION_CHUNK) {
      const statements = [];
      for (const p of fresh.slice(i, i + REGISTRATION_CHUNK)) {
        statements.push(
          db
            .prepare(
              "INSERT INTO console_commands(id,admin_id,action,target_type,target_id,source_id,expected_version,request_hash,details_json) VALUES(?,'sys-console-scheduler','job.create','job',?,?,0,?,?)",
            )
            .bind(
              p.commandId,
              p.id,
              p.sourceId,
              p.runKey,
              JSON.stringify({
                v2: 1,
                schedulerLease: lease,
                note: "官网采集到期任务登记",
                manualOverride: manualRun,
              }),
            ),
          db
            .prepare(
              "INSERT INTO ingestion_jobs(id,source_id,status,rule_version,source_version,policy_version,run_key,max_articles,updated_at,checkpoint_json) VALUES(?,?,'queued',?,?,?,?,2,?,'{}')",
            )
            .bind(
              p.id,
              p.sourceId,
              p.ruleVersion,
              p.version,
              p.policyVersion,
              p.runKey,
              stamp,
            ),
          db
            .prepare(
              "UPDATE knowledge_sources SET sync_hours_override=NULL,sync_state='queued',next_sync_at_ms=?,sync_policy_version=? WHERE id=?",
            )
            .bind(now + p.hours * 3600000, p.syncRevision, p.sourceId),
        );
      }
      await db.batch(statements);
      result.registered += fresh.slice(i, i + REGISTRATION_CHUNK).length;
    }
    result.state = result.registered ? "registered" : "no_eligible_due_source";
    return result;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    result = {
      ...result,
      state: "failed",
      reason: detail.includes("CONSOLE_")
        ? "POLICY_OR_VERSION_CHANGED"
        : "REGISTRATION_FAILED",
      detail: detail.slice(0, 180),
    };
    return result;
  } finally {
    await db
      .prepare(
        "UPDATE console_engine_settings SET scheduler_last_at=?,scheduler_result_json=?,scheduler_lease_until_ms=0,scheduler_lease_token=NULL WHERE id='console-v2-settings' AND scheduler_lease_token=?",
      )
      .bind(stamp, JSON.stringify(result), lease)
      .run();
  }
}

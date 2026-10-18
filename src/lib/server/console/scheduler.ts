import type { SqlDatabase } from "../assistant/database";
import { webProfiles } from "@/lib/ingestion/profiles";
type Due = {
  id: string;
  version: number;
  policy_version: number;
  rule_version: string;
  hours: number;
  next_sync_at_ms: number | null;
  sync_revision: number;
};
// No HTTP fetch, HTML parse, model call, Console/Next authentication or cleanup here.
// Cron only registers bounded tasks. An online, scoped Node runner executes them.
export async function dispatchDue(
  db: SqlDatabase,
  options: {
    now?: number;
    sourceId?: string;
    allowedIds?: string[];
    manualId?: string;
  } = {},
) {
  const now = options.now || Date.now(),
    stamp = new Date(now).toISOString(),
    lease = crypto.randomUUID();
  const locked = await db
    .prepare(
      "UPDATE console_engine_settings SET scheduler_lease_until_ms=?,scheduler_lease_token=? WHERE id='console-v2-settings' AND scheduler_lease_until_ms<=?",
    )
    .bind(now + 30000, lease, now)
    .run();
  if (!locked.meta.changes)
    return { state: "busy", registered: 0, completed: 0 };
  let result: {
    state: string;
    registered: number;
    completed: number;
    reason?: string;
  } = { state: "idle", registered: 0, completed: 0 };
  try {
    const settings = await db
      .prepare(
        "SELECT auto_sync_enabled,network_budget FROM console_engine_settings WHERE id='console-v2-settings'",
      )
      .first<{ auto_sync_enabled: number; network_budget: number }>();
    if (!settings?.auto_sync_enabled && !options.manualId) {
      result.state = "paused";
      return result;
    }
    const stale = await db
      .prepare(
        "SELECT j.id,j.source_id,j.version FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id LEFT JOIN source_collection_policies p ON p.source_id=s.id WHERE j.job_kind='web' AND j.control_state='active' AND j.phase<>'complete' AND (j.source_version<>s.version OR j.policy_version<>p.version OR p.source_id IS NULL OR p.expires_at_ms<=? OR s.enabled=0 OR s.affiliation_status<>'confirmed' OR s.operating_status<>'active' OR s.permission_status<>'approved') ORDER BY j.created_at,j.id LIMIT 2",
      )
      .bind(now)
      .all<{ id: string; source_id: string; version: number }>();
    for (const j of stale.results)
      await db.batch([
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
      ]);
    const usage = await db
      .prepare(
        "SELECT (SELECT count(*)*2 FROM console_commands WHERE action='job.claim' AND created_at>=strftime('%Y-%m-%dT00:00:00Z','now')) reserved,(SELECT count(*) FROM ingestion_jobs WHERE job_kind='web' AND created_at>=strftime('%Y-%m-%dT00:00:00Z','now')) jobs",
      )
      .first<{ reserved: number; jobs: number }>();
    if (
      (usage?.reserved || 0) >= Number(settings?.network_budget) ||
      Number(usage?.jobs || 0) >= 10
    ) {
      result.state = "budget_exhausted";
      return result;
    }
    const profiles = webProfiles
        .map((p) => p.sourceId)
        .filter((id) => !options.allowedIds || options.allowedIds.includes(id)),
      where = options.sourceId ? " AND s.id=?" : "";
    const rows = await db
      .prepare(
        `SELECT s.id,s.version,p.version AS policy_version,p.rule_version,COALESCE(s.sync_hours_override,e.sync_hours) hours,s.next_sync_at_ms,e.sync_revision FROM knowledge_sources s JOIN source_collection_policies p ON p.source_id=s.id CROSS JOIN console_engine_settings e WHERE s.id IN(${profiles.map(() => "?").join(",")}) AND s.enabled=1 AND s.affiliation_status='confirmed' AND s.operating_status='active' AND s.governance_checked_at IS NOT NULL AND s.verification_status='verified' AND s.official_status='verified_official' AND s.permission_status='approved' AND s.authorization_status='approved' AND s.archived_at IS NULL AND s.sync_state<>'blocked' AND p.expires_at_ms>?${where}
 AND (?=1 OR (CASE WHEN s.sync_policy_version>0 AND s.sync_policy_version<>e.sync_revision THEN COALESCE(CAST((julianday(s.last_success_at)-2440587.5)*86400000 AS INTEGER),0)+COALESCE(s.sync_hours_override,e.sync_hours)*3600000 ELSE COALESCE(s.next_sync_at_ms,0) END)<=?)
 AND NOT EXISTS(SELECT 1 FROM ingestion_jobs j WHERE j.source_id=s.id AND j.control_state='active' AND j.phase<>'complete' AND j.status IN('queued','running')) ORDER BY COALESCE(s.next_sync_at_ms,0),s.id LIMIT 2`,
      )
      .bind(
        ...profiles,
        now,
        ...(options.sourceId ? [options.sourceId] : []),
        Number(!!options.manualId),
        now,
      )
      .all<Due>();
    for (const s of rows.results) {
      if (result.registered + (usage?.jobs || 0) >= 10) break;
      const profile = webProfiles.find((p) => p.sourceId === s.id);
      if (profile?.ruleVersion !== s.rule_version) continue;
      const commandId = options.manualId || crypto.randomUUID(),
        id = "job-" + commandId,
        runKey = options.manualId
          ? `manual:${s.id}:${options.manualId}`
          : `scheduled:${s.id}:${s.version}:${s.next_sync_at_ms || 0}`;
      const old = await db
        .prepare("SELECT id FROM ingestion_jobs WHERE run_key=? OR id=?")
        .bind(runKey, id)
        .first();
      if (old) continue;
      await db.batch([
        db
          .prepare(
            "INSERT INTO console_commands(id,admin_id,action,target_type,target_id,source_id,expected_version,request_hash,details_json) VALUES(?,'sys-console-scheduler','job.create','job',?,?,0,?,?)",
          )
          .bind(
            commandId,
            id,
            s.id,
            runKey,
            JSON.stringify({
              v2: 1,
              schedulerLease: lease,
              note: "有界定时增量任务登记",
            }),
          ),
        db
          .prepare(
            "INSERT INTO ingestion_jobs(id,source_id,status,rule_version,source_version,policy_version,run_key,max_articles,updated_at,checkpoint_json) VALUES(?,?,'queued',?,?,?,?,1,?,'{}')",
          )
          .bind(
            id,
            s.id,
            s.rule_version,
            s.version,
            s.policy_version,
            runKey,
            stamp,
          ),
        db
          .prepare(
            "UPDATE knowledge_sources SET sync_state='queued',next_sync_at_ms=?,sync_policy_version=? WHERE id=?",
          )
          .bind(now + s.hours * 3600000, s.sync_revision, s.id),
      ]);
      result.registered++;
    }
    result.state = result.registered ? "registered" : "no_eligible_due_source";
    return result;
  } catch (e) {
    result = {
      ...result,
      state: "failed",
      reason: String(e).includes("CONSOLE_BUDGET")
        ? "BUDGET"
        : String(e).includes("CONSOLE_")
          ? "POLICY_OR_VERSION_CHANGED"
          : "REGISTRATION_FAILED",
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

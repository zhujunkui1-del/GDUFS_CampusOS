-- Official web collection is shared by the scheduled cloud executor and the
-- optional local runner. Remove the old application-wide daily crawl ceilings;
-- source policy, robots, leases, source-level pacing and platform quotas remain.
ALTER TABLE knowledge_sources ADD COLUMN web_profile_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(web_profile_json));
ALTER TABLE knowledge_sources ADD COLUMN last_executor TEXT CHECK(last_executor IN('cloud','local'));
ALTER TABLE console_engine_settings ADD COLUMN cloud_runner_last_at TEXT;

INSERT OR IGNORE INTO console_admins(id,email,role,principal_type,system_capability)
VALUES('sys-console-cloud','web-runner@system.invalid','operator','system','ingestion');

CREATE INDEX IF NOT EXISTS ingestion_jobs_web_executor_queue
ON ingestion_jobs(control_state,status,phase,lease_until_ms,next_run_after_ms,created_at)
WHERE job_kind='web';

DROP TRIGGER console_runner_command_guard;
CREATE TRIGGER console_runner_command_guard BEFORE INSERT ON console_commands BEGIN
 SELECT CASE WHEN NEW.action LIKE 'runner.%' AND NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND role='admin' AND principal_type='human' AND status='active') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.admin_id='sys-console-runner' AND NOT EXISTS(SELECT 1 FROM console_runner_tokens t,json_each(t.source_ids_json) scope WHERE t.id=json_extract(NEW.details_json,'$.runnerId') AND t.revoked_at_ms IS NULL AND t.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND scope.value=NEW.source_id) THEN RAISE(ABORT,'CONSOLE_DENIED') END;
END;

DROP TRIGGER ingestion_command_guard;
CREATE TRIGGER ingestion_command_guard BEFORE INSERT ON console_commands WHEN NEW.action IN('job.create','job.claim','job.commit') BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_sources s JOIN source_collection_policies p ON p.source_id=s.id
  WHERE s.id=NEW.source_id AND s.console_managed=1 AND s.channel_type='official_web' AND s.source_type='official_web'
  AND s.enabled=1 AND s.verification_status='verified' AND s.official_status='verified_official' AND s.permission_status='approved' AND s.authorization_status='approved'
  AND s.archived_at IS NULL AND p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
  THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
 SELECT CASE WHEN NEW.action='job.create' AND (NEW.expected_version<>0 OR EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id)) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action IN('job.claim','job.commit') AND NOT EXISTS(SELECT 1 FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id JOIN source_collection_policies p ON p.source_id=s.id
  WHERE j.id=NEW.target_id AND j.control_state='active' AND j.status IN('queued','running') AND s.version=j.source_version AND p.version=j.policy_version AND p.rule_version=j.rule_version)
  THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.claim' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id AND lease_until_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND next_run_after_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
  THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.claim' AND EXISTS(SELECT 1 FROM ingestion_jobs WHERE source_id=NEW.source_id AND id<>NEW.target_id AND lease_until_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.commit' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id AND lease_until_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND lease_hash=json_extract(NEW.details_json,'$.leaseHash') AND lease_fence=json_extract(NEW.details_json,'$.fence'))
  THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;

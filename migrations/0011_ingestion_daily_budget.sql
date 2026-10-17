-- Use reservation time in the immutable command ledger, not job creation day.
-- Old jobs resumed after UTC midnight cannot bypass the global daily budget.
CREATE INDEX console_ingestion_claim_time ON console_commands(created_at) WHERE action='job.claim';
DROP TRIGGER ingestion_command_guard;
CREATE TRIGGER ingestion_command_guard BEFORE INSERT ON console_commands WHEN NEW.action IN('job.create','job.claim','job.commit') BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_sources s JOIN source_collection_policies p ON p.source_id=s.id
 WHERE s.id=NEW.source_id AND s.console_managed=1 AND s.channel_type='official_web' AND s.source_type='official_web'
 AND s.enabled=1 AND s.verification_status='verified' AND s.official_status='verified_official' AND s.permission_status='approved' AND s.authorization_status='approved'
 AND s.archived_at IS NULL AND p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
 THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
 SELECT CASE WHEN NEW.action='job.create' AND (NEW.expected_version<>0 OR EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id)) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.create' AND (SELECT count(*) FROM ingestion_jobs WHERE created_at>=strftime('%Y-%m-%dT00:00:00Z','now'))>=10 THEN RAISE(ABORT,'CONSOLE_BUDGET') END;
 SELECT CASE WHEN NEW.action IN('job.claim','job.commit') AND NOT EXISTS(SELECT 1 FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id JOIN source_collection_policies p ON p.source_id=s.id
 WHERE j.id=NEW.target_id AND j.control_state='active' AND j.status IN('queued','running') AND s.version=j.source_version AND p.version=j.policy_version AND p.rule_version=j.rule_version)
 THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.claim' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id AND lease_until_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND next_run_after_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
 THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.claim' AND ((SELECT request_count FROM ingestion_jobs WHERE id=NEW.target_id)>18 OR (SELECT count(*)*2 FROM console_commands WHERE action='job.claim' AND created_at>=strftime('%Y-%m-%dT00:00:00Z','now'))>18) THEN RAISE(ABORT,'CONSOLE_BUDGET') END;
 SELECT CASE WHEN NEW.action='job.claim' AND EXISTS(SELECT 1 FROM ingestion_jobs WHERE source_id=NEW.source_id AND id<>NEW.target_id AND lease_until_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.commit' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id AND lease_until_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND lease_hash=json_extract(NEW.details_json,'$.leaseHash') AND lease_fence=json_extract(NEW.details_json,'$.fence'))
 THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;

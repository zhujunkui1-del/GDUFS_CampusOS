-- Collecting from a source the console configured must not depend on the
-- review labels ("已核验 / 官方 / 授权") that the console never writes itself.
-- Those labels stay visible in the registry, but the work guards now key off
-- the one fact the operator actually stated: the site is enabled with a saved
-- entry profile, not archived and not closed.
DROP TRIGGER IF EXISTS ingestion_command_guard;
CREATE TRIGGER ingestion_command_guard BEFORE INSERT ON console_commands WHEN NEW.action IN('job.create','job.claim','job.commit') BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_sources s
 WHERE s.id=NEW.source_id AND s.console_managed=1 AND s.channel_type='official_web' AND s.source_type='official_web'
 AND s.enabled=1 AND s.archived_at IS NULL AND s.operating_status<>'closed' AND s.sync_state<>'blocked')
 THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
 SELECT CASE WHEN NEW.action='job.create' AND (NEW.expected_version<>0 OR EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id)) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.create' AND (SELECT count(*) FROM ingestion_jobs WHERE created_at>=strftime('%Y-%m-%dT00:00:00Z','now'))>=10 THEN RAISE(ABORT,'CONSOLE_BUDGET') END;
 SELECT CASE WHEN NEW.action IN('job.claim','job.commit') AND NOT EXISTS(SELECT 1 FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id LEFT JOIN source_collection_policies p ON p.source_id=s.id
 WHERE j.id=NEW.target_id AND j.control_state='active' AND j.status IN('queued','running') AND s.version=j.source_version
 AND (j.policy_version=0 OR (p.version=j.policy_version AND p.rule_version=j.rule_version)))
 THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.claim' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id AND lease_until_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND next_run_after_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
 THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.claim' AND ((SELECT request_count FROM ingestion_jobs WHERE id=NEW.target_id)>18 OR (SELECT count(*)*2 FROM console_commands WHERE action='job.claim' AND created_at>=strftime('%Y-%m-%dT00:00:00Z','now'))>18) THEN RAISE(ABORT,'CONSOLE_BUDGET') END;
 SELECT CASE WHEN NEW.action='job.claim' AND EXISTS(SELECT 1 FROM ingestion_jobs WHERE source_id=NEW.source_id AND id<>NEW.target_id AND lease_until_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.commit' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id AND lease_until_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND lease_hash=json_extract(NEW.details_json,'$.leaseHash') AND lease_fence=json_extract(NEW.details_json,'$.fence'))
 THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;

DROP TRIGGER IF EXISTS console_source_enable_guard;
CREATE TRIGGER console_source_enable_guard BEFORE UPDATE ON knowledge_sources WHEN NEW.console_managed=1 AND NEW.enabled=1 BEGIN
 SELECT CASE WHEN NEW.archived_at IS NOT NULL OR NEW.operating_status='closed' THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
END;

DROP TRIGGER IF EXISTS console_v2_command_guard;
CREATE TRIGGER console_v2_command_guard BEFORE INSERT ON console_commands WHEN json_extract(NEW.details_json,'$.v2')=1 BEGIN
 SELECT CASE WHEN NEW.action='engine.settings' AND (SELECT role FROM console_admins WHERE id=NEW.admin_id)<>'admin' THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.action='engine.settings' AND NOT EXISTS(SELECT 1 FROM console_engine_settings WHERE id=NEW.target_id AND version=NEW.expected_version) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='source.enable' AND json_extract(NEW.details_json,'$.enabled')=1 AND NOT EXISTS(SELECT 1 FROM knowledge_sources WHERE id=NEW.target_id AND operating_status<>'closed' AND archived_at IS NULL) THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
 SELECT CASE WHEN NEW.action IN('job.create','job.claim','job.commit','document.publish') AND NOT EXISTS(SELECT 1 FROM knowledge_sources WHERE id=COALESCE(NEW.source_id,(SELECT source_id FROM knowledge_documents WHERE id=NEW.target_id)) AND enabled=1 AND archived_at IS NULL AND operating_status<>'closed' AND sync_state<>'blocked') THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
 SELECT CASE WHEN NEW.action='document.review' AND (SELECT role FROM console_admins WHERE id=NEW.admin_id) NOT IN('admin','reviewer') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
END;

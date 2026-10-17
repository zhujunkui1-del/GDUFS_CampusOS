-- Millisecond lease boundaries; preserve applied 0007/0008 and all data.
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
 SELECT CASE WHEN NEW.action='job.claim' AND ((SELECT request_count FROM ingestion_jobs WHERE id=NEW.target_id)>18 OR (SELECT COALESCE(sum(request_count),0) FROM ingestion_jobs WHERE created_at>=strftime('%Y-%m-%dT00:00:00Z','now'))>18) THEN RAISE(ABORT,'CONSOLE_BUDGET') END;
 SELECT CASE WHEN NEW.action='job.claim' AND EXISTS(SELECT 1 FROM ingestion_jobs WHERE source_id=NEW.source_id AND id<>NEW.target_id AND lease_until_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action='job.commit' AND NOT EXISTS(SELECT 1 FROM ingestion_jobs WHERE id=NEW.target_id AND lease_until_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND lease_hash=json_extract(NEW.details_json,'$.leaseHash') AND lease_fence=json_extract(NEW.details_json,'$.fence'))
 THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;

CREATE TRIGGER ingestion_policy_admin_guard BEFORE INSERT ON console_commands WHEN NEW.action='source.collection-policy' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND status='active' AND role='admin') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
END;
CREATE TRIGGER console_source_authorization_invalidate AFTER UPDATE OF authorization_status ON knowledge_sources
WHEN NEW.console_managed=1 AND NEW.authorization_status<>OLD.authorization_status AND NEW.permission_status=OLD.permission_status AND NEW.verification_status=OLD.verification_status AND NEW.official_status=OLD.official_status AND NEW.enabled=OLD.enabled AND NEW.archived_at IS OLD.archived_at BEGIN
 INSERT INTO content_index_invalidations(document_id,version,reason) SELECT id,version,'source_authorization_changed' FROM knowledge_documents WHERE source_id=NEW.id AND owner_user_id IS NULL AND data_domain<>'user_private';
END;

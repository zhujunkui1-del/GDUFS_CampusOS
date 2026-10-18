-- Registry status is an administrator choice, independent of collection/republishing rights.
-- Preserve all source evidence and every existing source enabled value.
DROP TRIGGER console_source_enable_guard;
CREATE TRIGGER console_source_enable_guard BEFORE UPDATE ON knowledge_sources WHEN NEW.console_managed=1 AND NEW.enabled=1 BEGIN
 SELECT CASE WHEN NEW.archived_at IS NOT NULL THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
END;
DROP TRIGGER console_v2_command_guard;
CREATE TRIGGER console_v2_command_guard BEFORE INSERT ON console_commands WHEN json_extract(NEW.details_json,'$.v2')=1 BEGIN
 SELECT CASE WHEN NEW.action='engine.settings' AND (SELECT role FROM console_admins WHERE id=NEW.admin_id)<>'admin' THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.action='engine.settings' AND NOT EXISTS(SELECT 1 FROM console_engine_settings WHERE id=NEW.target_id AND version=NEW.expected_version) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN NEW.action IN('job.create','job.claim','job.commit','manual.import','document.publish') AND NOT EXISTS(SELECT 1 FROM knowledge_sources WHERE id=COALESCE(NEW.source_id,(SELECT source_id FROM knowledge_documents WHERE id=NEW.target_id)) AND enabled=1 AND archived_at IS NULL) THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
 SELECT CASE WHEN NEW.action='document.review' AND (SELECT role FROM console_admins WHERE id=NEW.admin_id) NOT IN('admin','reviewer') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
END;
-- All active whitelist entries are permanent and exempt from historical intake cutoff.
-- Prior values remain available in immutable console command/audit history.
UPDATE console_protections SET expires_at_ms=NULL,history_exempt=1 WHERE active=1;

DROP TRIGGER manual_import_guard;
CREATE TRIGGER manual_import_guard BEFORE INSERT ON console_commands WHEN NEW.action='manual.import' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM knowledge_sources s WHERE s.id=NEW.source_id AND s.version=json_extract(NEW.details_json,'$.sourceVersion') AND s.console_managed=1 AND s.source_type<>'user_private' AND s.enabled=1 AND ((s.verification_status='verified' AND s.permission_status='approved' AND s.authorization_status='approved') OR (COALESCE(json_extract(NEW.details_json,'$.registryMetadata'),0)=1 AND (SELECT role FROM console_admins WHERE id=NEW.admin_id)='admin')) AND s.archived_at IS NULL) THEN RAISE(ABORT,'CONSOLE_SOURCE_NOT_READY') END;
 SELECT CASE WHEN NOT (COALESCE(json_extract(NEW.details_json,'$.registryMetadata'),0)=1 AND (SELECT role FROM console_admins WHERE id=NEW.admin_id)='admin') AND ((SELECT CASE WHEN s.manual_policy_version>0 THEN s.manual_policy_version ELSE COALESCE(p.version,0) END FROM knowledge_sources s LEFT JOIN source_collection_policies p ON p.source_id=s.id WHERE s.id=NEW.source_id)<>json_extract(NEW.details_json,'$.policyVersion') OR EXISTS(SELECT 1 FROM knowledge_sources s LEFT JOIN source_collection_policies p ON p.source_id=s.id WHERE s.id=NEW.source_id AND CASE WHEN s.manual_policy_version>0 THEN s.manual_policy_expires_at_ms ELSE COALESCE(p.expires_at_ms,9223372036854775807) END<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) ) THEN RAISE(ABORT,'CONSOLE_STALE') END;
 SELECT CASE WHEN (SELECT count(*) FROM console_commands WHERE action='manual.import' AND created_at>=strftime('%Y-%m-%dT00:00:00Z','now'))>=20 THEN RAISE(ABORT,'CONSOLE_BUDGET') END;
END;

DROP TRIGGER console_scheduler_pause_guard;
CREATE TRIGGER console_scheduler_pause_guard BEFORE INSERT ON console_commands WHEN NEW.admin_id='sys-console-scheduler' AND NEW.action='job.pause' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ingestion_jobs j JOIN knowledge_sources s ON s.id=j.source_id LEFT JOIN source_collection_policies p ON p.source_id=s.id WHERE j.id=NEW.target_id AND (j.source_version<>s.version OR j.policy_version<>p.version OR p.source_id IS NULL OR p.expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) OR s.enabled=0 OR s.operating_status<>'active' OR s.permission_status<>'approved')) THEN RAISE(ABORT,'CONSOLE_STALE') END;
END;

DROP TRIGGER console_v2_system_command_guard;
CREATE TRIGGER console_v2_system_command_guard BEFORE INSERT ON console_commands BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND principal_type='system' AND NOT((system_capability='publisher' AND NEW.action='document.auto_publish') OR (system_capability='scheduler' AND NEW.action IN('job.create','job.pause')) OR (system_capability='ingestion' AND NEW.action IN('job.create','job.claim','job.commit','job.pause','job.resume','job.cancel')))) THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.action='source.auto-policy' AND NOT EXISTS(SELECT 1 FROM console_admins WHERE id=NEW.admin_id AND principal_type='human' AND role='admin' AND status='active') THEN RAISE(ABORT,'CONSOLE_DENIED') END;
 SELECT CASE WHEN NEW.action='document.auto_publish' AND NOT EXISTS(
  SELECT 1 FROM console_admins a JOIN knowledge_documents d ON d.id=NEW.target_id JOIN knowledge_sources s ON s.id=d.source_id JOIN console_publication_policies p ON p.source_id=s.id JOIN console_content_checks c ON c.id=json_extract(NEW.details_json,'$.checkId')
  WHERE a.id=NEW.admin_id AND a.principal_type='system' AND a.system_capability='publisher' AND a.status='active' AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'
  AND s.enabled=1 AND s.operating_status='active' AND s.permission_status='approved' AND s.authorization_status='approved' AND s.archived_at IS NULL
  AND p.enabled=1 AND p.version=c.policy_version AND p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
  AND c.outcome='pass' AND c.document_id=d.id AND c.content_revision=d.content_revision AND c.input_hash=d.input_hash AND c.document_version=d.version AND c.source_version=s.version
  AND NOT EXISTS(SELECT 1 FROM console_document_controls x WHERE x.document_id=d.id AND x.hold_reason IS NOT NULL)
 ) THEN RAISE(ABORT,'CONSOLE_CONTENT_NOT_READY') END;
END;
